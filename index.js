require('dotenv').config();
const express = require('express');
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

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.post('/webhook', (req, res) => {
  console.log('--- Incoming Webhook ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('------------------------');

  const { message } = req.body;

  if (message && message.direction === 'received') {
    const from = message.from;
    const text = message.content.text;

    console.log(`[INFO] Received message from ${from}: "${text}"`);

    // RAG logic
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

        console.log(`[INFO] Replying to ${from} with: "${replyText}"`);
        messagebird.conversations.reply(message.conversationId, {
          type: 'text',
          content: { text: replyText }
        }, (err, response) => {
          if (err) {
            console.error('[ERROR] Failed to send reply via MessageBird:', err);
            return;
          }
          console.log('[SUCCESS] Reply sent successfully via MessageBird:', response);
        });

        client.release();
        console.log('[INFO] Database connection released.');
      } catch (err) {
        console.error('[ERROR] An error occurred in the RAG logic:', err.stack);
      }
    })();

    res.status(200).send('OK');
  } else {
    console.log('[INFO] Webhook received, but not a processable message. Acknowledging.');
    res.status(200).send('OK');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});