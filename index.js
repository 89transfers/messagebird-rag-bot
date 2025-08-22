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
  console.log('--- RAW INCOMING WEBHOOK ---');
  console.log('HEADERS:', JSON.stringify(req.headers, null, 2));
  console.log('BODY:', JSON.stringify(req.body, null, 2));
  console.log('--- END RAW WEBHOOK ---');
  
  res.sendStatus(200);
});

exports.whatsAppWebhook = app;