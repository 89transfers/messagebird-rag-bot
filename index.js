require('dotenv').config();
const { Pool } = require('pg');
const { initClient } = require('messagebird');
const OpenAI = require('openai');

const messagebird = initClient(process.env.MESSAGEBIRD_API_KEY);
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.YOUR_SITE_URL,
    'X-Title': process.env.YOUR_SITE_NAME,
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

exports.whatsAppWebhook = (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk.toString();
  });

  req.on('end', () => {
    console.log('--- Incoming Webhook ---');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Raw Body Received:', rawBody);
    console.log('------------------------');

    let payload;
    try {
      // The body from Flow Builder is now a proper JSON string
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error('[ERROR] Failed to parse incoming webhook body as JSON:', e);
      // It's crucial to send a 200 OK to prevent MessageBird from retrying.
      return res.status(200).send('Webhook processed, non-JSON body.');
    }
    
    const { message } = payload;

    if (message && message.direction === 'received') {
      const from = message.from;
      const text = message.content.text;

      console.log(`[INFO] Received message from ${from}: "${text}"`);

      (async () => {
        try {
          const client = await pool.connect();
          console.log('[INFO] Connected to database.');

          const query = 'SELECT content FROM documents WHERE content % $1 LIMIT 1';
          const result = await client.query(query, [text]);
          console.log('[INFO] Database query executed.');

          let context = "No relevant context found.";
          if (result.rows.length > 0) {
            context = result.rows[0].content;
            console.log('[INFO] Found context in database:', context);
          } else {
            console.log('[INFO] No context found for the given message.');
          }

          console.log('[INFO] Sending request to OpenRouter...');
          const completion = await openai.chat.completions.create({
            model: 'google/gemini-2.5-flash-lite-preview-06-17',
            messages: [
              { role: 'system', content: `You are a helpful assistant. Use the following context to answer the user's question. Context: ${context}` },
              { role: 'user', content: text },
            ],
          });

          const replyText = completion.choices[0].message.content;
          console.log('[INFO] Received response from OpenRouter:', replyText);

          // We must use conversations.reply now that we have the full message object
          console.log(`[INFO] Replying to conversation ${message.conversationId} with: "${replyText}"`);
          messagebird.conversations.reply(message.conversationId, {
            type: 'text',
            content: { text: replyText }
          }, (err, response) => {
            if (err) {
              console.error('[ERROR] Failed to send reply via MessageBird:', err);
              return;
            }
            console.log('[SUCCESS] Reply sent successfully:', response);
          });

          client.release();
          console.log('[INFO] Database connection released.');
        } catch (err) {
          console.error('[ERROR] An error occurred in the RAG logic:', err.stack);
        }
      })();

      res.status(200).send('Webhook processed successfully.');
    } else {
      console.log('[INFO] Webhook received, but not a processable inbound message. Acknowledging.');
      res.status(200).send('Webhook processed, not an inbound message.');
    }
  });
};