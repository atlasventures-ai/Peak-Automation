(function() {
  const script    = document.currentScript || document.querySelector('script[data-business]');
  const bizId     = script?.getAttribute('data-business');
  const serverUrl = script?.getAttribute('data-server') || window.location.origin;
  if (!bizId) return;

  let config      = null;
  let history     = [];
  let busy        = false;
  let isOpen      = false;
  let startTime   = Date.now();
  let hasBooking  = false;
  let convSaved   = false;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #pa-widget * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
    #pa-widget { position: fixed; bottom: 24px; right: 24px; z-index: 999999; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
    #pa-fab { width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 26px; box-shadow: 0 6px 24px rgba(0,0,0,0.25); transition: transform .2s; }
    #pa-fab:hover { transform: scale(1.1); }
    #pa-badge { position: absolute; top: -3px; right: -3px; width: 18px; height: 18px; background: #dc2626; border-radius: 50%; border: 2px solid white; font-size: 10px; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    #pa-fab-wrap { position: relative; }
    #pa-bubble { background: white; border-radius: 14px 14px 4px 14px; padding: 12px 16px; box-shadow: 0 6px 24px rgba(0,0,0,0.13); font-size: 13px; line-height: 1.5; max-width: 240px; border: 1px solid #e5e7eb; }
    #pa-bubble strong { display: block; margin-bottom: 3px; font-size: 13px; }
    #pa-bubble span { color: #6b7280; font-size: 12px; }
    #pa-window { width: 360px; height: 500px; background: white; border-radius: 18px; box-shadow: 0 16px 60px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; border: 1px solid #e5e7eb; transform-origin: bottom right; }
    #pa-window.pa-hidden { display: none; }
    #pa-header { padding: 16px 18px; display: flex; align-items: center; gap: 11px; flex-shrink: 0; }
    #pa-avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; border: 2px solid rgba(255,255,255,0.4); flex-shrink: 0; }
    #pa-info h4 { font-size: 14px; font-weight: 700; color: white; }
    #pa-info span { font-size: 11px; color: rgba(255,255,255,0.8); display: flex; align-items: center; gap: 5px; }
    .pa-dot { width: 6px; height: 6px; border-radius: 50%; background: #86efac; }
    #pa-close { margin-left: auto; background: rgba(255,255,255,0.2); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; }
    #pa-after-hours-bar { background: #fef3c7; border-bottom: 1px solid #fcd34d; padding: 8px 14px; font-size: 12px; color: #92400e; display: none; flex-shrink: 0; }
    #pa-msgs { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 12px; background: #f9fafb; }
    #pa-msgs::-webkit-scrollbar { width: 4px; }
    #pa-msgs::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
    .pa-bot-row { display: flex; gap: 8px; align-items: flex-end; }
    .pa-bot-av { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
    .pa-bot-bubble { background: white; border: 1px solid #e5e7eb; border-radius: 14px 14px 14px 4px; padding: 10px 13px; font-size: 13px; line-height: 1.6; color: #111827; max-width: 82%; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
    .pa-user-row { display: flex; justify-content: flex-end; }
    .pa-user-bubble { border-radius: 14px 14px 4px 14px; padding: 10px 13px; font-size: 13px; line-height: 1.6; color: white; max-width: 82%; }
    .pa-typing { display: flex; gap: 4px; padding: 6px 2px; }
    .pa-typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: pa-bounce 1.2s ease-in-out infinite; }
    .pa-typing span:nth-child(2) { animation-delay: .2s; }
    .pa-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes pa-bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
    .pa-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .pa-qr { background: white; border-radius: 20px; padding: 5px 12px; font-size: 11px; font-weight: 600; cursor: pointer; transition: all .2s; font-family: inherit; }
    #pa-footer { padding: 12px 14px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; background: white; flex-shrink: 0; }
    #pa-input { flex: 1; border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 9px 12px; font-size: 13px; font-family: inherit; outline: none; color: #111827; background: #f9fafb; transition: border-color .2s; }
    #pa-input:focus { border-color: var(--pa-primary, #3b82f6); background: white; }
    #pa-send { width: 38px; height: 38px; border-radius: 10px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; transition: transform .15s; }
    #pa-send:hover { transform: scale(1.1); }
    .pa-booking-confirm { background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 10px 13px; font-size: 12px; color: #166534; margin-top: 4px; }
  `;
  document.head.appendChild(style);

  // ── HTML ────────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.id = 'pa-widget';
  wrap.innerHTML = `
    <div id="pa-bubble"><strong>👋 Questions? We're here!</strong><span>Tap to chat — takes 30 seconds</span></div>
    <div id="pa-fab-wrap">
      <button id="pa-fab">💬</button>
      <div id="pa-badge">1</div>
    </div>
    <div id="pa-window" class="pa-hidden">
      <div id="pa-header">
        <div id="pa-avatar">🤖</div>
        <div id="pa-info"><h4>Assistant</h4><span><span class="pa-dot"></span> Online</span></div>
        <button id="pa-close">✕</button>
      </div>
      <div id="pa-after-hours-bar">🌙 We're closed right now — leave your info and we'll call you back!</div>
      <div id="pa-msgs"></div>
      <div id="pa-footer">
        <input id="pa-input" type="text" placeholder="Type a message..." />
        <button id="pa-send">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const fabEl       = document.getElementById('pa-fab');
  const badgeEl     = document.getElementById('pa-badge');
  const bubbleEl    = document.getElementById('pa-bubble');
  const windowEl    = document.getElementById('pa-window');
  const msgsEl      = document.getElementById('pa-msgs');
  const inputEl     = document.getElementById('pa-input');
  const sendEl      = document.getElementById('pa-send');
  const closeEl     = document.getElementById('pa-close');
  const afterHoursEl = document.getElementById('pa-after-hours-bar');
  const headerEl    = document.getElementById('pa-header');
  const avatarEl    = document.getElementById('pa-avatar');
  const infoEl      = document.getElementById('pa-info');

  // ── Load config + hours ──────────────────────────────────────────────────────
  async function init() {
    try {
      const [bizRes, hoursRes] = await Promise.all([
        fetch(`${serverUrl}/api/business/${bizId}`),
        fetch(`${serverUrl}/api/hours/${bizId}`)
      ]);
      config = await bizRes.json();
      const hours = await hoursRes.json();

      const primary   = config.colors?.primary   || '#3b82f6';
      const secondary = config.colors?.secondary || '#2563eb';
      const headerTxt = config.colors?.headerText || '#ffffff';

      // Apply branding
      document.documentElement.style.setProperty('--pa-primary', primary);
      headerEl.style.background  = `linear-gradient(135deg, ${primary}, ${secondary})`;
      fabEl.style.background     = `linear-gradient(135deg, ${primary}, ${secondary})`;
      fabEl.style.color          = headerTxt;
      sendEl.style.background    = primary;
      sendEl.style.color         = headerTxt;
      avatarEl.textContent       = config.icon || '🤖';
      avatarEl.style.background  = `rgba(255,255,255,0.2)`;

      document.getElementById('pa-info').querySelector('h4').textContent = config.name || 'Assistant';

      // After-hours banner
      if (!hours.open) {
        afterHoursEl.style.display = 'block';
        if (hours.emergency) {
          afterHoursEl.textContent = '🚨 We\'re closed but emergency service is available — chat now!';
          afterHoursEl.style.background = '#fef2f2';
          afterHoursEl.style.borderColor = '#fca5a5';
          afterHoursEl.style.color = '#991b1b';
        }
      }

      // Style quick replies
      document.querySelectorAll('.pa-qr').forEach(btn => {
        btn.style.border = `1.5px solid ${primary}`;
        btn.style.color  = primary;
        btn.addEventListener('mouseenter', () => { btn.style.background = primary; btn.style.color = '#fff'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'white'; btn.style.color = primary; });
      });

    } catch(e) {
      console.error('Widget init error:', e);
    }
  }

  // ── Greeting ─────────────────────────────────────────────────────────────────
  function showGreeting() {
    if (!config) return;
    const row = document.createElement('div');
    row.className = 'pa-bot-row';
    const primary = config.colors?.primary || '#3b82f6';
    const secondary = config.colors?.secondary || '#2563eb';
    row.innerHTML = `
      <div class="pa-bot-av" style="background:linear-gradient(135deg,${primary},${secondary});color:#fff;">${config.icon || '🤖'}</div>
      <div>
        <div class="pa-bot-bubble">${config.greeting || 'Hi! How can I help you today?'}</div>
        <div class="pa-quick-replies">
          ${(config.quickReplies || []).map(qr => `<button class="pa-qr" onclick="paQuickSend(this,'${qr.text.replace(/'/g,"\\\'")}')">${qr.label}</button>`).join('')}
        </div>
      </div>
    `;
    msgsEl.appendChild(row);
    const primary2 = config.colors?.primary || '#3b82f6';
    row.querySelectorAll('.pa-qr').forEach(btn => {
      btn.style.border = `1.5px solid ${primary2}`;
      btn.style.color  = primary2;
      btn.addEventListener('mouseenter', () => { btn.style.background = primary2; btn.style.color = '#fff'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'white'; btn.style.color = primary2; });
    });
  }

  window.paQuickSend = function(btn, text) {
    document.querySelectorAll('.pa-quick-replies').forEach(el => el.remove());
    inputEl.value = text;
    send();
  };

  // ── Toggle widget ─────────────────────────────────────────────────────────────
  function openWidget() {
    isOpen = true;
    windowEl.classList.remove('pa-hidden');
    bubbleEl.style.display = 'none';
    badgeEl.style.display  = 'none';
    fabEl.textContent = '✕';
    startTime = Date.now();
    if (msgsEl.children.length === 0) showGreeting();
    inputEl.focus();
  }

  function closeWidget() {
    isOpen = false;
    windowEl.classList.add('pa-hidden');
    fabEl.textContent = '💬';
    saveConversation();
  }

  fabEl.addEventListener('click',  () => isOpen ? closeWidget() : openWidget());
  closeEl.addEventListener('click', closeWidget);

  // ── Booking detection ─────────────────────────────────────────────────────────
  function detectBooking(text) {
    const match = text.match(/\[BOOKING:([^\]]+)\]/);
    if (!match) return null;
    const [name, phone, service, datetime] = match[1].split('|');
    return { name: name?.trim(), phone: phone?.trim(), service: service?.trim(), datetime: datetime?.trim() };
  }

  async function submitBooking(booking) {
    hasBooking = true;
    try {
      await fetch(`${serverUrl}/api/booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...booking, businessId: bizId })
      });
      // Show confirmation badge in chat
      const confirm = document.createElement('div');
      confirm.className = 'pa-booking-confirm';
      confirm.textContent = '✅ Booking request captured! Someone will call you to confirm.';
      msgsEl.appendChild(confirm);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch(e) { console.error('Booking submit error:', e); }
  }

  // ── Save conversation log ─────────────────────────────────────────────────────
  async function saveConversation() {
    if (convSaved || history.length < 2) return;
    convSaved = true;
    try {
      await fetch(`${serverUrl}/api/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: bizId,
          messages: history,
          durationMs: Date.now() - startTime,
          hasBooking
        })
      });
    } catch(e) { console.error('Conv save error:', e); }
  }

  // Save on page unload
  window.addEventListener('beforeunload', saveConversation);

  // ── Add message bubbles ───────────────────────────────────────────────────────
  function addBot(text) {
    const primary   = config?.colors?.primary   || '#3b82f6';
    const secondary = config?.colors?.secondary || '#2563eb';
    const row = document.createElement('div');
    row.className = 'pa-bot-row';
    row.innerHTML = `<div class="pa-bot-av" style="background:linear-gradient(135deg,${primary},${secondary});color:#fff;">${config?.icon || '🤖'}</div><div class="pa-bot-bubble"></div>`;
    msgsEl.appendChild(row);
    const bubble = row.querySelector('.pa-bot-bubble');
    if (text) bubble.textContent = text;
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return bubble;
  }

  function addUser(text) {
    const primary = config?.colors?.primary || '#3b82f6';
    const row = document.createElement('div');
    row.className = 'pa-user-row';
    row.innerHTML = `<div class="pa-user-bubble" style="background:linear-gradient(135deg,${primary},${config?.colors?.secondary||primary})">${text}</div>`;
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function addTyping() {
    const primary   = config?.colors?.primary   || '#3b82f6';
    const secondary = config?.colors?.secondary || '#2563eb';
    const row = document.createElement('div');
    row.className = 'pa-bot-row';
    row.innerHTML = `<div class="pa-bot-av" style="background:linear-gradient(135deg,${primary},${secondary});color:#fff;">${config?.icon || '🤖'}</div><div class="pa-bot-bubble"><div class="pa-typing"><span></span><span></span><span></span></div></div>`;
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return row;
  }

  // ── Send message ──────────────────────────────────────────────────────────────
  async function send() {
    const text = inputEl.value.trim();
    if (!text || busy) return;
    busy = true;
    sendEl.disabled = true;
    inputEl.value = '';
    document.querySelectorAll('.pa-quick-replies').forEach(el => el.remove());
    addUser(text);
    history.push({ role: 'user', content: text });
    const typingRow = addTyping();

    try {
      const res = await fetch(`${serverUrl}/api/chat/${bizId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });

      typingRow.remove();
      const bubble = addBot();
      let full = '';
      let displayText = '';

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'text') {
              full += evt.text;
              // Strip [BOOKING:...] from display
              displayText = full.replace(/\[BOOKING:[^\]]*\]/g, '').trim();
              bubble.textContent = displayText;
              msgsEl.scrollTop = msgsEl.scrollHeight;
            }
          } catch {}
        }
      }

      // Check for booking tag
      const booking = detectBooking(full);
      if (booking) {
        await submitBooking(booking);
        convSaved = false; // allow re-save with booking flag
      }

      history.push({ role: 'assistant', content: displayText });

    } catch (err) {
      typingRow.remove();
      addBot('Sorry, something went wrong. Please call us directly. 📞');
    }

    busy = false;
    sendEl.disabled = false;
    inputEl.focus();
  }

  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });

  // ── Auto-open after 5 seconds ─────────────────────────────────────────────────
  setTimeout(() => { if (!isOpen) openWidget(); }, 5000);

  init();
})();
