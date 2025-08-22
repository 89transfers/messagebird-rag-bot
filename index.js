require('dotenv').config();
const { Pool } = require('pg');
const { initClient } = require('messagebird');
const OpenAI = require('openai');

const messagebird = initClient(process.env.MESSAGEBIRD_API_KEY);
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

exports.whatsAppWebhook = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  console.log('--- Incoming Webhook ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Received Body:', JSON.stringify(req.body, null, 2));
  console.log('------------------------');

  const { conversationId, message } = req.body;

  if (!conversationId || !message || !message.content || !message.content.text) {
    console.log('[WARN] Webhook received without required fields. Acknowledging.');
    return res.status(200).send('OK');
  }
  
  const from = message.from;
  const text = message.content.text;

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT content FROM documents WHERE content % $1 LIMIT 1', [text]);
    client.release();

    const context = result.rows.length > 0 ? result.rows[0].content : "No relevant context found.";
    
    const completion = await openai.chat.completions.create({
      model: 'google/gemini-2.5-flash-lite-preview-06-17',
      messages: [
        { role: 'system', content: `Use this context to answer: ${context}` },
        { role: 'user', content: text },
      ],
    });

    const replyText = completion.choices[0].message.content;
    
    messagebird.conversations.reply(conversationId, {
      type: 'text',
      content: { text: replyText }
    }, (err) => {
      if (err) {
        console.error('[ERROR] Failed to send reply via MessageBird:', err);
      } else {
        console.log(`[SUCCESS] Replied to ${from} with: "${replyText}"`);
      }
    });

  } catch (err) {
    console.error('[ERROR] An error occurred in the RAG logic:', err.stack);
  }

  res.status(200).send('OK');
};