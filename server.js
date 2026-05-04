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

// ── Lead Gen — Reddit search ────────────────────────────────────────────────
// Craigslist — "services wanted" section
async function searchCraigslistLeads(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled) return [];
  const city    = cfg.craigslistCity || 'saltlakecity';
  const keywords = (cfg.keywords || []).slice(0, 3).join(' OR ');
  const url = `https://${city}.craigslist.org/search/sss?query=${encodeURIComponent(keywords)}&sort=date`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const results = [];
    // Parse post titles + links from Craigslist HTML
    const re = /data-pid="(\d+)"[^>]*>[\s\S]*?class="posting-title"[^>]*>[\s\S]*?<span[^>]*class="label"[^>]*>([^<]+)<\/span>[\s\S]*?href="([^"]+)"/g;
    const re2 = /href="(\/[^"]+\.html)"[^>]*>[\s\S]*?<span class="label">([^<]+)<\/span>/g;
    // Simpler: grab all result titles
    const titleRe = /<a href="(https:\/\/[^"]+\.html)"[^>]*class="posting-title"[^>]*>[^<]*<span[^>]*>([^<]+)<\/span>/g;
    let m;
    const cutoffSec = Date.now()/1000 - (cfg.lookbackHours || 48)*3600;
    while ((m = titleRe.exec(html)) !== null && results.length < 5) {
      results.push({ title: m[2].trim(), url: m[1], source: 'Craigslist', ageHours: null, snippet: '' });
    }
    return results;
  } catch(e) {
    console.error('Craigslist error:', e.message);
    return [];
  }
}

// Google search — finds publicly indexed posts from Nextdoor, local forums, Facebook public groups
async function searchWebLeads(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled || !cfg?.webSearchEnabled) return [];
  const location = cfg.location || 'Salt Lake City Utah';
  const service  = cfg.serviceLabel || biz.name;
  const query    = `"looking for" OR "recommend" OR "need a" ${service} ${location} -site:yelp.com -site:homeadvisor.com`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=qdr:w&num=10`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const results = [];
    const re = /href="(https?:\/\/(?!webcache|google)[^"&]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 5) {
      const url2 = m[1];
      const title = m[2].replace(/<[^>]+>/g,'').trim();
      if (title && url2 && !url2.includes('google.com')) {
        results.push({ title, url: url2, source: 'Web', ageHours: null, snippet: '' });
      }
    }
    return results;
  } catch(e) {
    console.error('Web search error:', e.message);
    return [];
  }
}

// Yelp — scrape Q&A and "looking for" reviews
async function searchYelpLeads(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled) return [];
  const location = encodeURIComponent(cfg.location || 'Salt Lake City, UT');
  const service  = encodeURIComponent(cfg.serviceLabel || 'HVAC');
  const url = `https://www.yelp.com/search?find_desc=${service}&find_loc=${location}&sortby=review_count`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const results = [];
    // Find businesses that have Q&A activity
    const bizRe = /"businessName":"([^"]+)"[\s\S]*?"businessUrl":"([^"]+)"/g;
    let m;
    let count = 0;
    while ((m = bizRe.exec(html)) !== null && count < 3) {
      results.push({ title: `Q&A opportunity: ${m[1]}`, url: `https://www.yelp.com${m[2]}?osq=${service}`, source: 'Yelp', snippet: 'Check Q&A section for people asking for recommendations' });
      count++;
    }
    return results;
  } catch(e) {
    console.error('Yelp error:', e.message);
    return [];
  }
}

// Angi — public project/request listings
async function searchAngiLeads(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled) return [];
  const service  = encodeURIComponent((cfg.keywords || ['HVAC'])[0]);
  const location = encodeURIComponent(cfg.location || 'Salt Lake City, UT');
  const url = `https://www.angi.com/companylist/us/${location.toLowerCase().replace(/[^a-z0-9]+/g,'-')}/${service}.htm`;
  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const results = [];
    // Find recent project requests
    const re = /"recentProjectDescription":"([^"]{20,})"/g;
    let m;
    while ((m = re.exec(html)) !== null && results.length < 5) {
      results.push({ title: m[1].slice(0,100), url: `https://www.angi.com/tasks/${service}/`, source: 'Angi', snippet: 'Recent project request' });
    }
    if (results.length === 0) {
      // Fallback — just link to the Angi leads section
      results.push({ title: `Recent ${cfg.serviceLabel || 'service'} requests in ${cfg.location || 'your area'}`, url: `https://www.angi.com/companylist/us/ut/salt-lake-city/${service}.htm`, source: 'Angi', snippet: 'Check for recent project requests' });
    }
    return results;
  } catch(e) {
    console.error('Angi error:', e.message);
    return [];
  }
}

// Google Maps — find competitor businesses with recent negative reviews (unhappy customers = warm leads)
async function searchCompetitorReviews(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled || !cfg?.competitorKeywords?.length) return [];
  const results = [];
  for (const competitor of (cfg.competitorKeywords || []).slice(0,3)) {
    const query = `${competitor} ${cfg.location || 'Salt Lake City'} reviews site:google.com OR site:yelp.com`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=3`;
    try {
      const res  = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      const html = await res.text();
      const re   = /href="(https?:\/\/(?!google)[^"&]+)".*?<h3[^>]*>([^<]+)<\/h3>/g;
      let m;
      while ((m = re.exec(html)) !== null && results.length < 3) {
        results.push({ title: `Competitor activity: ${m[2].trim()}`, url: m[1], source: 'Google Reviews', snippet: competitor });
      }
    } catch(e) {}
  }
  return results;
}

async function searchRedditLeads(biz) {
  const cfg = biz.leadGen;
  if (!cfg?.enabled) return [];

  const subreddits = (cfg.subreddits || ['SaltLakeCity','Utah']).join('+');
  const keywords   = (cfg.keywords  || [biz.name]).join('+OR+');
  const url = `https://www.reddit.com/r/${subreddits}/search.json?q=${encodeURIComponent(keywords)}&sort=new&restrict_sr=1&limit=10&t=week`;

  try {
    const res  = await fetch(url, { headers: { 'User-Agent': 'PeakAutomation/1.0' } });
    const data = await res.json();
    const posts = data?.data?.children || [];
    const cutoff = Date.now()/1000 - (cfg.lookbackHours || 48) * 3600;
    return posts
      .map(p => p.data)
      .filter(p => p.created_utc > cutoff)
      .map(p => ({
        title:     p.title,
        url:       `https://reddit.com${p.permalink}`,
        subreddit: p.subreddit,
        ageHours:  Math.round((Date.now()/1000 - p.created_utc) / 3600),
        snippet:   p.selftext?.slice(0,200) || ''
      }));
  } catch(e) {
    console.error('Reddit search error:', e.message);
    return [];
  }
}

app.post('/api/leadgen/run/:businessId', async (req, res) => {
  const biz = getBusinesses()[req.params.businessId];
  if (!biz) return res.status(404).json({ error: 'Not found' });
  if (!biz.leadGen?.enabled) return res.status(400).json({ error: 'Lead gen not enabled' });

  // Run all sources in parallel
  const [redditLeads, craigslistLeads, webLeads, yelpLeads, angiLeads, competitorLeads] = await Promise.all([
    searchRedditLeads(biz),
    searchCraigslistLeads(biz),
    searchWebLeads(biz),
    searchYelpLeads(biz),
    searchAngiLeads(biz),
    searchCompetitorReviews(biz)
  ]);

  const all = [
    ...redditLeads.map(l      => ({ ...l, source: 'Reddit' })),
    ...craigslistLeads.map(l  => ({ ...l, source: 'Craigslist' })),
    ...webLeads.map(l         => ({ ...l, source: 'Web' })),
    ...yelpLeads.map(l        => ({ ...l, source: 'Yelp' })),
    ...angiLeads.map(l        => ({ ...l, source: 'Angi' })),
    ...competitorLeads.map(l  => ({ ...l, source: 'Google Reviews' }))
  ];

  if (all.length === 0) return res.json({ found: 0, leads: [] });

  // Group by source for Telegram
  const sections = [];
  if (redditLeads.length)     sections.push(`🗨️ <b>Reddit (${redditLeads.length})</b>\n` + redditLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));
  if (craigslistLeads.length) sections.push(`📌 <b>Craigslist (${craigslistLeads.length})</b>\n` + craigslistLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));
  if (webLeads.length)        sections.push(`🌐 <b>Web (${webLeads.length})</b>\n` + webLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));
  if (yelpLeads.length)       sections.push(`⭐ <b>Yelp (${yelpLeads.length})</b>\n` + yelpLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));
  if (angiLeads.length)       sections.push(`🔧 <b>Angi (${angiLeads.length})</b>\n` + angiLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));
  if (competitorLeads.length) sections.push(`🔍 <b>Competitor Intel (${competitorLeads.length})</b>\n` + competitorLeads.map(l => `• ${l.title}\n  ${l.url}`).join('\n'));

  const msg = `🎯 <b>Lead Gen — ${biz.name}</b>\n<b>${all.length} potential leads found</b>\n\n${sections.join('\n\n')}\n\n<i>Reach out before your competitors do!</i>`;
  await sendTelegram(msg);

  res.json({ found: all.length, leads: all });
});

app.get('/api/leadgen/run/:businessId', async (req, res) => {
  const biz = getBusinesses()[req.params.businessId];
  if (!biz) return res.status(404).json({ error: 'Not found' });
  const [redditLeads, craigslistLeads] = await Promise.all([
    searchRedditLeads(biz), searchCraigslistLeads(biz)
  ]);
  const all = [...redditLeads, ...craigslistLeads];
  res.json({ found: all.length, leads: all });
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
