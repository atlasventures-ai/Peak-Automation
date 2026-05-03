const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4242;
const LEADS_FILE = path.join(__dirname, 'leads.json');

function getLeads() {
  if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');
  return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
}

function saveLead(lead) {
  const leads = getLeads();
  leads.unshift({ ...lead, id: Date.now(), createdAt: new Date().toISOString() });
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('Telegram error:', e.message); }
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const ATLAS_SYSTEM = `You are Atlas, an AI assistant built for Brax (Braxton), a journeyman electrician on the Wasatch Front in Utah. Brax works for his dad's electrical contracting company and does residential side work (EV chargers, basement finishes, panel upgrades, etc). He's also building Conduit — an electrical bidding software for commercial contractors that integrates supplier pricing sheets to save estimators hours per bid.

Your personality:
- Direct, no-BS, like talking to a sharp friend who knows their stuff
- Skip filler phrases like "Great question!" — just answer
- You have opinions and you share them
- Practical and action-oriented — Brax is a trades guy, not a corporate guy
- Casual but competent
- Keep responses concise unless they ask you to go deep

You know about: commercial and residential electrical work, Conduit bidding tool, Alpaca paper trading bots, EV charger installs, AI automation agency, Brax's goals of financial freedom.`;

function getBusinesses() {
  const bizPath = path.join(__dirname, 'businesses.json');
  return JSON.parse(fs.readFileSync(bizPath, 'utf8'));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Contact form submission ───────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, phone, business, type, website } = req.body;
  if (!name || !phone || !business) return res.status(400).json({ error: 'Missing required fields' });
  saveLead({ name, phone, business, type, website, source: 'contact-form' });
  const msg = `⚡ <b>New Lead — Peak Automation</b>\n\n👤 <b>${name}</b>\n📱 ${phone}\n🏢 ${business}\n🏷️ ${type || 'Not specified'}\n🌐 ${website || 'No website'}\n\n<i>via contact form</i>`;
  await sendTelegram(msg);
  res.json({ success: true });
});

// ── Chat lead capture ─────────────────────────────────────────────────────────
app.post('/api/lead', async (req, res) => {
  const { name, phone, businessId, source } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Missing fields' });
  saveLead({ name, phone, businessId, source: source || 'chat-widget' });
  const biz = businessId ? `on <b>${businessId}</b>` : '';
  const msg = `💬 <b>New Chat Lead</b> ${biz}\n\n👤 <b>${name}</b>\n📱 ${phone}\n\n<i>Started chatting on peakautomation.io</i>`;
  await sendTelegram(msg);
  res.json({ success: true });
});

// ── Leads dashboard ───────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  res.json(getLeads());
});

// ── Atlas personal chat ──────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: ATLAS_SYSTEM,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    stream.on('text', t => res.write(`data: ${JSON.stringify({ type: 'text', text: t })}\n\n`));
    stream.on('message', () => { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); });
    stream.on('error', err => { res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// ── Business config ──────────────────────────────────────────────────────────
app.get('/api/business/:id', (req, res) => {
  const businesses = getBusinesses();
  const biz = businesses[req.params.id];
  if (!biz) return res.status(404).json({ error: 'Business not found' });
  // Don't expose the system prompt to the client
  const { prompt, ...safe } = biz;
  res.json(safe);
});

// ── List all businesses (for admin) ─────────────────────────────────────────
app.get('/api/businesses', (req, res) => {
  const businesses = getBusinesses();
  const list = Object.values(businesses).map(({ id, name, tagline, icon, colors }) => ({ id, name, tagline, icon, colors }));
  res.json(list);
});

// ── Add/update a business ────────────────────────────────────────────────────
app.post('/api/business', (req, res) => {
  const businesses = getBusinesses();
  const biz = req.body;
  if (!biz.id) return res.status(400).json({ error: 'id required' });
  businesses[biz.id] = biz;
  fs.writeFileSync(path.join(__dirname, 'businesses.json'), JSON.stringify(businesses, null, 2));
  res.json({ success: true, id: biz.id });
});

// ── Widget chat (business-specific) ─────────────────────────────────────────
app.post('/api/chat/:businessId', async (req, res) => {
  const businesses = getBusinesses();
  const biz = businesses[req.params.businessId];
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const { messages } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: biz.prompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    stream.on('text', t => res.write(`data: ${JSON.stringify({ type: 'text', text: t })}\n\n`));
    stream.on('message', () => { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); });
    stream.on('error', err => { res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

// ── Legacy demo-chat (keep for existing demos) ───────────────────────────────
app.post('/demo-chat', async (req, res) => {
  const { messages, businessPrompt } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: businessPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });
    stream.on('text', t => res.write(`data: ${JSON.stringify({ type: 'text', text: t })}\n\n`));
    stream.on('message', () => { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); });
    stream.on('error', err => { res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`); res.end(); });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n⚡ Atlas AI is running at http://localhost:${PORT}`);
  console.log(`   Admin panel:  http://localhost:${PORT}/admin.html`);
  console.log(`   Widget demo:  http://localhost:${PORT}/widget-demo.html\n`);
});
