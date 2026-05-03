(function () {
  const script = document.currentScript;
  const businessId = script?.getAttribute('data-business');
  const serverUrl = script?.getAttribute('data-server') || 'http://localhost:4242';

  if (!businessId) { console.warn('[Atlas Widget] Missing data-business attribute'); return; }

  // Fetch business config then boot
  fetch(`${serverUrl}/api/business/${businessId}`)
    .then(r => r.json())
    .then(biz => boot(biz, serverUrl))
    .catch(err => console.warn('[Atlas Widget] Failed to load config:', err));

  function boot(biz, server) {
    const p  = biz.colors.primary;
    const s  = biz.colors.secondary;

    // ── Inject styles ──────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      #atlas-widget * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
      #atlas-widget {
        position: fixed; bottom: 24px; right: 24px;
        z-index: 999999;
        display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
      }
      #atlas-fab {
        width: 60px; height: 60px; border-radius: 50%;
        background: linear-gradient(135deg, ${p}, ${s});
        border: none; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px;
        box-shadow: 0 6px 24px ${p}88;
        transition: transform 0.2s;
        position: relative;
      }
      #atlas-fab:hover { transform: scale(1.1); }
      #atlas-fab-badge {
        position: absolute; top: -3px; right: -3px;
        width: 18px; height: 18px; background: #ef4444;
        border-radius: 50%; border: 2px solid white;
        font-size: 10px; color: white; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
      }
      #atlas-window {
        width: 360px; height: 500px;
        background: white; border-radius: 18px;
        box-shadow: 0 16px 60px rgba(0,0,0,0.18);
        display: flex; flex-direction: column; overflow: hidden;
        border: 1px solid #e5e7eb;
        animation: atlas-slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1);
        transform-origin: bottom right;
      }
      #atlas-window.atlas-hidden { display: none; }
      @keyframes atlas-slide-up {
        from { opacity: 0; transform: scale(0.85) translateY(16px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      #atlas-header {
        background: linear-gradient(135deg, ${p}, ${s});
        color: white; padding: 16px 18px;
        display: flex; align-items: center; gap: 10px; flex-shrink: 0;
      }
      #atlas-avatar {
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(255,255,255,0.2);
        display: flex; align-items: center; justify-content: center;
        font-size: 20px; border: 2px solid rgba(255,255,255,0.35);
        flex-shrink: 0;
      }
      #atlas-header-info h4 { font-size: 14px; font-weight: 700; color: white; }
      #atlas-header-info span {
        font-size: 11px; opacity: 0.8;
        display: flex; align-items: center; gap: 4px; color: white;
      }
      .atlas-online-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #86efac; box-shadow: 0 0 5px #86efac;
        animation: atlas-blink 2s infinite;
      }
      @keyframes atlas-blink { 0%,100%{opacity:1} 50%{opacity:.2} }
      #atlas-close {
        margin-left: auto;
        background: rgba(255,255,255,0.18); border: none;
        color: white; width: 28px; height: 28px;
        border-radius: 50%; cursor: pointer; font-size: 14px;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.2s;
      }
      #atlas-close:hover { background: rgba(255,255,255,0.3); }
      #atlas-messages {
        flex: 1; overflow-y: auto;
        padding: 16px 14px;
        display: flex; flex-direction: column; gap: 12px;
        background: #f9fafb;
      }
      #atlas-messages::-webkit-scrollbar { width: 3px; }
      #atlas-messages::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
      .atlas-bot-row { display: flex; gap: 8px; align-items: flex-start; }
      .atlas-bot-av {
        width: 28px; height: 28px; border-radius: 50%;
        background: linear-gradient(135deg, ${p}, ${s});
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; flex-shrink: 0;
      }
      .atlas-bot-bubble {
        background: white; border: 1px solid #e5e7eb;
        border-radius: 14px 14px 14px 4px;
        padding: 10px 13px; font-size: 13px;
        line-height: 1.6; color: #111827; max-width: 86%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        animation: atlas-msg 0.25s ease;
        white-space: pre-wrap; word-break: break-word;
      }
      .atlas-user-row { display: flex; justify-content: flex-end; animation: atlas-msg 0.25s ease; }
      .atlas-user-bubble {
        background: linear-gradient(135deg, ${p}, ${s});
        color: white; border-radius: 14px 14px 4px 14px;
        padding: 10px 13px; font-size: 13px;
        line-height: 1.6; max-width: 86%;
      }
      @keyframes atlas-msg { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
      .atlas-typing-row { display: flex; gap: 8px; align-items: flex-start; }
      .atlas-typing-bubble {
        background: white; border: 1px solid #e5e7eb;
        border-radius: 14px 14px 14px 4px;
        padding: 12px 14px; display: flex; gap: 4px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
      }
      .atlas-typing-bubble span {
        width: 6px; height: 6px; border-radius: 50%;
        background: #9ca3af; animation: atlas-bounce 1.2s ease-in-out infinite;
      }
      .atlas-typing-bubble span:nth-child(2) { animation-delay: .2s; }
      .atlas-typing-bubble span:nth-child(3) { animation-delay: .4s; }
      @keyframes atlas-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
      .atlas-quick-replies { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 6px; }
      .atlas-qr {
        background: white; border: 1.5px solid ${p};
        color: ${p}; border-radius: 18px;
        padding: 5px 12px; font-size: 11px; font-weight: 600;
        cursor: pointer; transition: all 0.2s; font-family: inherit;
      }
      .atlas-qr:hover { background: ${p}; color: white; }
      #atlas-footer {
        padding: 12px 14px; border-top: 1px solid #e5e7eb;
        display: flex; gap: 8px; background: white; flex-shrink: 0;
      }
      #atlas-input {
        flex: 1; border: 1.5px solid #e5e7eb;
        border-radius: 10px; padding: 9px 12px;
        font-size: 13px; font-family: inherit;
        outline: none; color: #111827;
        background: #f9fafb; transition: border-color 0.2s;
      }
      #atlas-input:focus { border-color: ${p}; background: white; }
      #atlas-input::placeholder { color: #9ca3af; }
      #atlas-send {
        width: 38px; height: 38px; border-radius: 10px;
        background: linear-gradient(135deg, ${p}, ${s});
        border: none; cursor: pointer; color: white;
        font-size: 15px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.15s;
        box-shadow: 0 3px 10px ${p}55;
      }
      #atlas-send:hover { transform: scale(1.07); }
      #atlas-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      #atlas-powered {
        text-align: center; font-size: 10px;
        color: #9ca3af; padding: 5px 0 3px;
        background: white; letter-spacing: 0.3px;
      }
      #atlas-powered a { color: ${p}; text-decoration: none; font-weight: 600; }
    `;
    document.head.appendChild(style);

    // ── Build HTML ─────────────────────────────────────────────────────────
    const widget = document.createElement('div');
    widget.id = 'atlas-widget';
    widget.innerHTML = `
      <div id="atlas-window" class="atlas-hidden">
        <div id="atlas-header">
          <div id="atlas-avatar">${biz.icon}</div>
          <div id="atlas-header-info">
            <h4>${biz.name}</h4>
            <span><div class="atlas-online-dot"></div> Online · Replies instantly</span>
          </div>
          <button id="atlas-close">✕</button>
        </div>
        <div id="atlas-messages"></div>
        <div id="atlas-footer">
          <input id="atlas-input" placeholder="Type a message..." />
          <button id="atlas-send">➤</button>
        </div>
        <div id="atlas-powered">Powered by <a href="https://atlasaiautomation.com" target="_blank">Atlas AI Automation</a> ⚡</div>
      </div>
      <button id="atlas-fab">
        <span id="atlas-fab-icon">💬</span>
        <div id="atlas-fab-badge">1</div>
      </button>
    `;
    document.body.appendChild(widget);

    // ── State & refs ───────────────────────────────────────────────────────
    const win     = document.getElementById('atlas-window');
    const msgs    = document.getElementById('atlas-messages');
    const input   = document.getElementById('atlas-input');
    const send    = document.getElementById('atlas-send');
    const fab     = document.getElementById('atlas-fab');
    const fabIcon = document.getElementById('atlas-fab-icon');
    const badge   = document.getElementById('atlas-fab-badge');
    const closeBtn = document.getElementById('atlas-close');

    let history = [], busy = false, open = false;

    // ── Greeting ───────────────────────────────────────────────────────────
    function showGreeting() {
      const row = document.createElement('div');
      row.className = 'atlas-bot-row';
      row.innerHTML = `<div class="atlas-bot-av">${biz.icon}</div><div></div>`;
      const wrap = row.querySelector('div:last-child');
      const bubble = document.createElement('div');
      bubble.className = 'atlas-bot-bubble';
      bubble.textContent = biz.greeting;
      wrap.appendChild(bubble);

      if (biz.quickReplies?.length) {
        const qrs = document.createElement('div');
        qrs.className = 'atlas-quick-replies';
        qrs.id = 'atlas-qr-container';
        biz.quickReplies.forEach(qr => {
          const btn = document.createElement('button');
          btn.className = 'atlas-qr';
          btn.textContent = qr.label;
          btn.addEventListener('click', () => {
            document.getElementById('atlas-qr-container')?.remove();
            input.value = qr.text;
            sendMsg();
          });
          qrs.appendChild(btn);
        });
        wrap.appendChild(qrs);
      }
      msgs.appendChild(row);
    }

    // ── Toggle ─────────────────────────────────────────────────────────────
    function openWidget() {
      open = true;
      win.classList.remove('atlas-hidden');
      fabIcon.textContent = '✕';
      badge.style.display = 'none';
      if (msgs.children.length === 0) showGreeting();
      setTimeout(() => input.focus(), 100);
    }

    function closeWidget() {
      open = false;
      win.classList.add('atlas-hidden');
      fabIcon.textContent = '💬';
    }

    fab.addEventListener('click', () => open ? closeWidget() : openWidget());
    closeBtn.addEventListener('click', closeWidget);

    // ── Chat ───────────────────────────────────────────────────────────────
    function addBot(text = '') {
      const row = document.createElement('div');
      row.className = 'atlas-bot-row';
      const bubble = document.createElement('div');
      bubble.className = 'atlas-bot-bubble';
      row.innerHTML = `<div class="atlas-bot-av">${biz.icon}</div>`;
      if (text) bubble.textContent = text;
      row.appendChild(bubble);
      msgs.appendChild(row);
      msgs.scrollTop = msgs.scrollHeight;
      return bubble;
    }

    function addUser(text) {
      const row = document.createElement('div');
      row.className = 'atlas-user-row';
      row.innerHTML = `<div class="atlas-user-bubble">${text}</div>`;
      msgs.appendChild(row);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function addTyping() {
      const row = document.createElement('div');
      row.className = 'atlas-typing-row';
      row.innerHTML = `<div class="atlas-bot-av">${biz.icon}</div><div class="atlas-typing-bubble"><span></span><span></span><span></span></div>`;
      msgs.appendChild(row);
      msgs.scrollTop = msgs.scrollHeight;
      return row;
    }

    async function sendMsg() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      input.value = '';
      addUser(text);
      history.push({ role: 'user', content: text });
      const typing = addTyping();

      try {
        const res = await fetch(`${server}/api/chat/${biz.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history }),
        });

        typing.remove();
        const bubble = addBot();
        let full = '';
        const reader = res.body.getReader();
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
              if (evt.type === 'text') { full += evt.text; bubble.textContent = full; msgs.scrollTop = msgs.scrollHeight; }
            } catch {}
          }
        }
        history.push({ role: 'assistant', content: full });

      } catch {
        typing.remove();
        addBot('Sorry, something went wrong. Please contact us directly.');
      }

      busy = false;
      send.disabled = false;
      input.focus();
    }

    send.addEventListener('click', sendMsg);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } });

    // Auto-open after 5s
    setTimeout(() => { if (!open) openWidget(); }, 5000);
  }
})();
