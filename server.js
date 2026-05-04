const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4242;
const LEADS_FILE        = path.join(__dirname, 'leads.json');
const BOOKINGS_FILE     = path.join(__dirname, 'bookings.json');
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');

// ── File helpers ─────────────────────────────────────────────────────────────
function readJson(file, def = []) {
  if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(def)); return def; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function getLeads()         { return readJson(LEADS_FILE, []); }
function getBookings()      { return readJson(BOOKINGS_FILE, []); }
function getConversations() { return readJson(CONVERSATIONS_FILE, []); }

function saveLead(lead) {
  const list = getLeads();
  list.unshift({ ...lead, id: Date.now(), createdAt: new Date().toISOString() });
  writeJson(LEADS_FILE, list);
}
function saveBooking(booking) {
  const list = getBookings();
  list.unshift({ ...booking, id: Date.now(), createdAt: new Date().toISOString() });
  writeJson(BOOKINGS_FILE, list);
}
function saveConversation(conv) {
  const list = getConversations();
  list.unshift({ ...conv, id: Date.now(), savedAt: new Date().toISOString() });
  if (list.length > 500) list.splice(500);
  writeJson(CONVERSATIONS_FILE, list);
}

function getBusinesses() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'businesses.json'), 'utf8'));
}

// ── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
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

// ── Hours check ──────────────────────────────────────────────────────────────
function checkHours(hours) {
  if (!hours) return { open: true, emergency: false, message: null };
  const tz   = hours.timezone || 'America/Denver';
  const now  = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);

  const dayAbbr = parts.find(p => p.type === 'weekday')?.value; // 'Mon', 'Tue' etc
  const hour    = parseInt(parts.find(p => p.type === 'hour')?.value   || '0');
  const minute  = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const current = hour * 60 + minute;

  const keyMap = { Sun:'sun', Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat' };
  const key     = keyMap[dayAbbr] || dayAbbr?.toLowerCase().slice(0,3);
  const schedule = hours[key];

  if (!schedule) {
    return { open: false, emergency: !!hours.emergency, message: "We're closed today." };
  }

  const [openStr, closeStr] = schedule.split('-');
  const [oH, oM] = openStr.split(':').map(Number);
  const [cH, cM] = closeStr.split(':').map(Number);

  if (current >= oH*60+oM && current < cH*60+cM) {
    return { open: true, emergency: !!hours.emergency, message: `We're open until ${closeStr}` };
  } else {
    return { open: false, emergency: !!hours.emergency, message: `We're closed right now (open ${openStr}–${closeStr} today)` };
  }
}

function localTimeString(tz = 'America/Denver') {
  return new Date().toLocaleString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

// ── Build system prompt with hours + booking instructions ────────────────────
function buildSystemPrompt(biz) {
  const status = checkHours(biz.hours);
  const tz     = biz.hours?.timezone || 'America/Denver';
  const now    = localTimeString(tz);
  let prompt   = biz.prompt;

  const bookingInstructions = `

BOOKING & LEAD CAPTURE — CRITICAL INSTRUCTIONS:
When a customer wants to schedule service, get a quote, or shows clear intent to hire:
1. Ask for their FULL NAME
2. Ask for their PHONE NUMBER
3. Ask what SERVICE they need
4. Ask for their PREFERRED DATE/TIME (or if it's urgent/ASAP)
Once you have all four pieces of info, output EXACTLY this on its own line (do not display it as part of the message — it will be processed automatically):
[BOOKING:name|phone|service|datetime]
Then immediately confirm: "Perfect! I've got your info and someone will call you shortly to confirm."
If they won't give a phone number, still capture name + service and output: [BOOKING:name|no-phone|service|datetime]`;

  if (!status.open) {
    prompt += `\n\nCURRENT TIME: ${now} — THE BUSINESS IS CURRENTLY CLOSED. ${status.emergency ? 'Emergency service IS available 24/7 — provide the phone number immediately for emergencies.' : 'No emergency service is available right now.'}
Tell customers you're closed but you'd love to get them taken care of. Capture their info using the booking flow above and tell them someone will call first thing when you open.`;
  } else {
    prompt += `\n\nCURRENT TIME: ${now} — THE BUSINESS IS OPEN.`;
  }

  prompt += bookingInstructions;
  return { prompt, status };
}

// ── Anthropic client ─────────────────────────────────────────────────────────
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Hours check endpoint ─────────────────────────────────────────────────────
app.get('/api/hours/:businessId', (req, res) => {
  const biz = getBusinesses()[req.params.businessId];
  if (!biz) return res.status(404).json({ error: 'Not found' });
  res.json(checkHours(biz.hours));
});

// ── Booking capture ──────────────────────────────────────────────────────────
app.post('/api/booking', async (req, res) => {
  const { name, phone, service, datetime, businessId, conversation } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const biz = getBusinesses()[businessId] || { name: businessId || 'Unknown' };

  saveBooking({ name, phone, service, datetime, businessId, businessName: biz.name, conversation });
  saveLead({ name, phone, businessId, businessName: biz.name, source: 'chat-booking' });

  const msg = `📅 <b>New Booking Request!</b>\n\n🏢 <b>${biz.name}</b>\n👤 <b>${name}</b>\n📱 ${phone || 'No phone'}\n🔧 ${service || 'Not specified'}\n🕐 ${datetime || 'ASAP'}\n\n<i>Captured via AI chat widget</i>`;
  await sendTelegram(msg);

  res.json({ success: true });
});

app.get('/api/bookings', (req, res) => res.json(getBookings()));

// ── Conversation log ─────────────────────────────────────────────────────────
app.post('/api/conversation', (req, res) => {
  const { businessId, messages, durationMs, hasBooking } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });
  const biz = getBusinesses()[businessId] || { name: businessId };
  saveConversation({ businessId, businessName: biz.name, messages, durationMs, hasBooking });
  res.json({ success: true });
});

app.get('/api/conversations', (req, res) => res.json(getConversations()));

// ── Contact form ─────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  const { name, phone, business, type, website } = req.body;
  if (!name || !phone || !business) return res.status(400).json({ error: 'Missing fields' });
  saveLead({ name, phone, business, type, website, source: 'contact-form' });
  await sendTelegram(`⚡ <b>New Lead — Peak Automation</b>\n\n👤 <b>${name}</b>\n📱 ${phone}\n🏢 ${business}\n🏷️ ${type || '—'}\n🌐 ${website || '—'}\n\n<i>via contact form</i>`);
  res.json({ success: true });
});

// ── Chat lead capture (manual) ───────────────────────────────────────────────
app.post('/api/lead', async (req, res) => {
  const { name, phone, businessId, source } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Missing fields' });
  saveLead({ name, phone, businessId, source: source || 'chat-widget' });
  await sendTelegram(`💬 <b>New Chat Lead</b>\n\n👤 <b>${name}</b>\n📱 ${phone}\n🏢 ${businessId || '—'}\n\n<i>via chat widget</i>`);
  res.json({ success: true });
});

app.get('/api/leads', (req, res) => res.json(getLeads()));

// ── Business config ──────────────────────────────────────────────────────────
app.get('/api/business/:id', (req, res) => {
  const biz = getBusinesses()[req.params.id];
  if (!biz) return res.status(404).json({ error: 'Not found' });
  const { prompt, ...safe } = biz;
  res.json(safe);
});

app.get('/api/businesses', (req, res) => {
  const list = Object.values(getBusinesses()).map(({ id, name, tagline, icon, colors }) => ({ id, name, tagline, icon, colors }));
  res.json(list);
});

app.post('/api/business', (req, res) => {
  const businesses = getBusinesses();
  const biz = req.body;
  if (!biz.id) return res.status(400).json({ error: 'id required' });
  businesses[biz.id] = biz;
  writeJson(path.join(__dirname, 'businesses.json'), businesses);
  res.json({ success: true, id: biz.id });
});

// ── Widget chat (business-specific) ─────────────────────────────────────────
app.post('/api/chat/:businessId', async (req, res) => {
  const biz = getBusinesses()[req.params.businessId];
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const { messages } = req.body;
  const { prompt } = buildSystemPrompt(biz);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: prompt,
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

// ── Atlas personal chat ──────────────────────────────────────────────────────
const ATLAS_SYSTEM = `You are Atlas, Brax's personal AI assistant. Direct, no-BS, like a sharp friend who knows their stuff.`;

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

app.listen(PORT, () => {
  console.log(`\n⚡ Peak Automation running at http://localhost:${PORT}`);
  console.log(`   Admin:     http://localhost:${PORT}/admin.html`);
  console.log(`   Bookings:  http://localhost:${PORT}/bookings.html\n`);
});
