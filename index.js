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
// Use text parser because Flow Builder sends the payload as raw text
// while keeping the Content-Type header as application/json.
app.use(express.text({ type: 'application/json' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.post('/webhook', (req, res) => {
  console.log('--- Incoming Webhook ---');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Raw Body:', req.body);
  console.log('------------------------');

  // The body is raw text from the message. There's no JSON to parse.
  // We also don't have the "from" address reliably.
  // This is a significant limitation of the Flow Builder's "Call API" step.
  // We will assume the body is the text and proceed.
  const text = req.body;
  const from = req.headers['x-messagebird-originator']; // Attempt to get the sender from headers

  if (text && from) {

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

        console.log(`[INFO] Sending new message to ${from} with: "${replyText}"`);
        messagebird.messages.create({
          originator: process.env.MESSAGEBIRD_CHANNEL_ID,
          recipients: [ from ],
          body: replyText
        }, (err, response) => {
          if (err) {
            console.error('[ERROR] Failed to send message via MessageBird:', err);
            return;
          }
          console.log('[SUCCESS] Message sent successfully:', response);
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

exports.whatsAppWebhook = app;