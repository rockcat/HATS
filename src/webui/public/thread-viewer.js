// thread-viewer.js — <conversation-threads agent="Name"> web component
// Slack-style two-column threaded conversation viewer with compose support

class ConversationThreads extends HTMLElement {
  static get observedAttributes() { return ['agent']; }

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
    this._agentName = null;
    this._threads = {};
    this._generalMessages = [];
    this._pendingMessages = [];        // sent but not yet confirmed by server
    this._pendingThreadMessages = [];
    this._activeThread = null;
    this._activeMessages = [];
    this._agentState = null;
    this._pollTimer = null;
    this._newThreadMode = false;
    this._sending = false;
    this._shadow.innerHTML = this._template();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  connectedCallback() {
    this._agentName = this.getAttribute('agent');
    this._bindEvents();
    this._refresh();
    this._startPolling();
  }

  disconnectedCallback() {
    this._stopPolling();
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'agent') {
      this._agentName = value;
      this._activeThread = null;
      this._newThreadMode = false;
      this._pendingMessages = [];
      this._pendingThreadMessages = [];
      this._refresh();
    }
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  _startPolling(intervalMs = 5000) {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._refresh(), intervalMs);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _bumpPolling() {
    // Poll every 2s for 30s after a send to catch agent responses quickly, then settle back
    this._startPolling(2000);
    clearTimeout(this._pollSettleTimer);
    this._pollSettleTimer = setTimeout(() => this._startPolling(5000), 30000);
  }

  // ── Data fetching ────────────────────────────────────────────────────────

  async _refresh() {
    if (!this._agentName) { this._renderPlaceholder('No agent selected'); return; }
    try {
      const [threadsRes, agentsRes] = await Promise.all([
        fetch(`/api/agents/${encodeURIComponent(this._agentName)}/threads`),
        fetch('/api/agents'),
      ]);
      if (!threadsRes.ok) { this._renderPlaceholder('Agent not found'); return; }
      this._threads = await threadsRes.json();
      if (agentsRes.ok) {
        const agents = await agentsRes.json();
        const found = agents.find(a => a.name === this._agentName);
        this._agentState = found?.state ?? null;
      }
      await this._loadGeneral();
      if (this._activeThread) await this._loadThread(this._activeThread);
      this._renderAndRestoreDrafts();
    } catch {
      this._renderPlaceholder('Failed to load conversation');
    }
  }

  _renderAndRestoreDrafts() {
    const active       = this._shadow.activeElement;
    const inGeneral    = !!active?.closest?.('#general-compose');
    const inThread     = !!active?.closest?.('#thread-compose');
    const inName       = active?.id === 'new-thread-name';
    const selStart     = active?.selectionStart ?? null;
    const selEnd       = active?.selectionEnd   ?? null;
    const genInputH    = this._shadow.querySelector('#general-compose .compose-input')?.style.height ?? '';
    const threadInputH = this._shadow.querySelector('#thread-compose .compose-input')?.style.height ?? '';

    const genDraft    = this._shadow.querySelector('#general-compose .compose-input')?.value ?? '';
    const threadDraft = this._shadow.querySelector('#thread-compose .compose-input')?.value ?? '';
    const threadName  = this._shadow.querySelector('#new-thread-name')?.value ?? '';

    // Smart scroll: stay at bottom if already there, else preserve position
    const gmEl = this._shadow.getElementById('general-messages');
    const tmEl = this._shadow.getElementById('thread-messages');
    const gmAtBottom = !gmEl || (gmEl.scrollHeight - gmEl.scrollTop - gmEl.clientHeight < 80);
    const tmAtBottom = !tmEl || (tmEl.scrollHeight - tmEl.scrollTop - tmEl.clientHeight < 80);
    const gmScroll   = gmEl?.scrollTop ?? 0;
    const tmScroll   = tmEl?.scrollTop ?? 0;

    this._render();

    // Restore draft text and textarea heights
    const gi = this._shadow.querySelector('#general-compose .compose-input');
    if (gi) { if (genDraft) gi.value = genDraft; if (genInputH) gi.style.height = genInputH; }
    const ti = this._shadow.querySelector('#thread-compose .compose-input');
    if (ti) { if (threadDraft) ti.value = threadDraft; if (threadInputH) ti.style.height = threadInputH; }
    const ni = this._shadow.querySelector('#new-thread-name');
    if (ni && threadName) ni.value = threadName;

    // Restore focus and cursor position
    if (inGeneral && gi) { gi.focus(); if (selStart !== null) gi.setSelectionRange(selStart, selEnd); }
    else if (inThread && ti) { ti.focus(); if (selStart !== null) ti.setSelectionRange(selStart, selEnd); }
    else if (inName   && ni) { ni.focus(); if (selStart !== null) ni.setSelectionRange(selStart, selEnd); }

    // Apply scroll after layout settles (rAF overrides _render's eager scrollTop)
    requestAnimationFrame(() => {
      const gm = this._shadow.getElementById('general-messages');
      if (gm) gm.scrollTop = gmAtBottom ? gm.scrollHeight : gmScroll;
      const tm = this._shadow.getElementById('thread-messages');
      if (tm) tm.scrollTop = tmAtBottom ? tm.scrollHeight : tmScroll;
    });
  }

  async _loadGeneral() {
    const res = await fetch(`/api/agents/${encodeURIComponent(this._agentName)}/history?thread=general`);
    if (res.ok) {
      const msgs = await res.json();
      // Clear pending messages that the server has now confirmed (matched by content)
      this._pendingMessages = this._pendingMessages.filter(p =>
        !msgs.some(m => m.role === 'user' && m.content.replace(/^\[.*?\]\s*/, '') === p.content)
      );
      // Always accept server data; pending messages are appended separately in render
      this._generalMessages = msgs;
    }
  }

  async _loadThread(key) {
    const res = await fetch(`/api/agents/${encodeURIComponent(this._agentName)}/history?thread=${encodeURIComponent(key)}`);
    if (res.ok) {
      const msgs = await res.json();
      this._pendingThreadMessages = this._pendingThreadMessages.filter(p =>
        !msgs.some(m => m.role === 'user' && m.content.replace(/^\[.*?\]\s*/, '') === p.content)
      );
      this._activeMessages = msgs;
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    this._shadow.addEventListener('click', e => {
      const item = e.target.closest('.thread-item');
      if (item) { this._openThread(item.dataset.key); return; }
      const close = e.target.closest('.panel-close');
      if (close) { this._closeThread(); return; }
      const sendBtn = e.target.closest('.compose-send-btn');
      if (sendBtn) { this._handleComposeSend(sendBtn.dataset.panel); return; }
      const newThread = e.target.closest('.new-thread-btn');
      if (newThread) { this._toggleNewThreadMode(); return; }
      const replyBtn = e.target.closest('.reply-in-thread-btn');
      if (replyBtn) { this._replyInThread(replyBtn.dataset.key); return; }
    });

    this._shadow.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const input = e.target.closest('.compose-input');
        if (input) {
          e.preventDefault();
          const panel = input.closest('[data-panel]')?.dataset.panel;
          if (panel) this._handleComposeSend(panel);
        }
      }
    });

    this._shadow.addEventListener('input', e => {
      const input = e.target.closest('.compose-input');
      if (input) {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      }
    });
  }

  async _openThread(key) {
    this._activeThread = key;
    this._pendingThreadMessages = [];
    await this._loadThread(key);
    this._render();
  }

  _closeThread() {
    this._activeThread = null;
    this._activeMessages = [];
    this._pendingThreadMessages = [];
    this._render();
  }

  _toggleNewThreadMode() {
    this._newThreadMode = !this._newThreadMode;
    this._render();
    if (this._newThreadMode) {
      const ni = this._shadow.querySelector('#new-thread-name');
      if (ni) ni.focus();
    } else {
      const gi = this._shadow.querySelector('#general-compose .compose-input');
      if (gi) gi.focus();
    }
  }

  async _replyInThread(key) {
    if (!key) return;
    if (this._threads[key]) {
      await this._openThread(key);
    } else {
      this._activeThread = key;
      this._activeMessages = [];
      this._render();
    }
    const ti = this._shadow.querySelector('#thread-compose .compose-input');
    if (ti) ti.focus();
  }

  // ── Compose / send ────────────────────────────────────────────────────────

  async _handleComposeSend(panel) {
    if (this._sending || !this._agentName) return;

    if (panel === 'general') {
      if (this._newThreadMode) {
        const ni  = this._shadow.querySelector('#new-thread-name');
        const ci  = this._shadow.querySelector('#general-compose .compose-input');
        const key = ni?.value.trim();
        const msg = ci?.value.trim();
        if (!key || !msg) return;
        if (ni) ni.value = '';
        if (ci) { ci.value = ''; ci.style.height = 'auto'; }
        this._newThreadMode = false;
        this._activeThread = key;
        this._activeMessages = [{ role: 'user', content: msg, timestamp: new Date().toISOString() }];
        this._render();
        this._doSend(msg, key).then(() => this._bumpPolling());
      } else {
        const ci  = this._shadow.querySelector('#general-compose .compose-input');
        const msg = ci?.value.trim();
        if (!msg) return;
        this._pendingMessages = [...this._pendingMessages, { role: 'user', content: msg, timestamp: new Date().toISOString(), _pending: true }];
        if (ci) { ci.value = ''; ci.style.height = 'auto'; }
        this._render();
        this._shadow.getElementById('general-messages').scrollTop = this._shadow.getElementById('general-messages').scrollHeight;
        this._doSend(msg, 'general').then(() => this._bumpPolling());
      }
    } else if (panel === 'thread') {
      const ci  = this._shadow.querySelector('#thread-compose .compose-input');
      const msg = ci?.value.trim();
      if (!msg || !this._activeThread) return;
      this._pendingThreadMessages = [...this._pendingThreadMessages, { role: 'user', content: msg, timestamp: new Date().toISOString(), _pending: true }];
      if (ci) { ci.value = ''; ci.style.height = 'auto'; }
      this._render();
      this._shadow.getElementById('thread-messages').scrollTop = this._shadow.getElementById('thread-messages').scrollHeight;
      this._doSend(msg, this._activeThread).then(() => this._bumpPolling());
    }
  }

  async _doSend(text, threadId) {
    this._sending = true;
    try {
      await fetch('/api/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: `@${this._agentName} ${text}`, threadId }),
      });
    } finally {
      this._sending = false;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render() {
    const root = this._shadow.getElementById('root');
    if (!root) return;

    const nonGeneral = Object.entries(this._threads).filter(([k]) => k !== 'general');
    const rightOpen  = !!this._activeThread;

    root.innerHTML = `
      <div class="layout${rightOpen ? ' layout--split' : ''}">
        <div class="left-panel">
          <div class="panel-header"># general</div>
          <div class="messages-area" id="general-messages">
            ${this._renderMessages([...this._generalMessages, ...this._pendingMessages], 'general', this._agentState)}
          </div>
          <div class="threads-section">
            <div class="threads-divider">
              <span>Threads</span>
              <button class="new-thread-btn${this._newThreadMode ? ' new-thread-btn--active' : ''}">${this._newThreadMode ? '✕ Cancel' : '+ New'}</button>
            </div>
            ${nonGeneral.map(([k, count]) => `
              <div class="thread-item${this._activeThread === k ? ' thread-item--active' : ''}" data-key="${this._esc(k)}">
                <span class="thread-icon">&#x1f9f5;</span>
                <span class="thread-key">${this._shortKey(k)}</span>
                <span class="thread-count">${count} msg${count !== 1 ? 's' : ''}</span>
                <span class="thread-arrow">&#8594;</span>
              </div>
            `).join('')}
          </div>
          <div class="compose-bar" id="general-compose" data-panel="general">
            ${this._newThreadMode ? `
              <input id="new-thread-name" class="thread-name-input" placeholder="Thread name…" autocomplete="off" />
            ` : ''}
            <textarea class="compose-input" rows="1" placeholder="${this._newThreadMode ? 'First message…' : 'Message #general… (Enter to send)'}"></textarea>
            <div class="compose-footer">
              ${!this._newThreadMode ? `<button class="new-thread-btn" title="Start a new thread">+ Thread</button>` : '<span></span>'}
              <button class="compose-send-btn${this._sending ? ' compose-send-btn--busy' : ''}" data-panel="general"${this._sending ? ' disabled' : ''}>Send</button>
            </div>
          </div>
        </div>
        ${rightOpen ? `
        <div class="right-panel">
          <div class="panel-header panel-header--right">
            <span>Thread: ${this._shortKey(this._activeThread)}</span>
            <button class="panel-close" title="Close">&#x2715;</button>
          </div>
          <div class="messages-area" id="thread-messages">
            ${this._renderMessages([...this._activeMessages, ...this._pendingThreadMessages], this._activeThread, this._agentState)}
          </div>
          <div class="compose-bar" id="thread-compose" data-panel="thread">
            <textarea class="compose-input" rows="1" placeholder="Reply in thread… (Enter to send)"></textarea>
            <div class="compose-footer">
              <span></span>
              <button class="compose-send-btn${this._sending ? ' compose-send-btn--busy' : ''}" data-panel="thread"${this._sending ? ' disabled' : ''}>Reply</button>
            </div>
          </div>
        </div>` : ''}
      </div>
    `;

    const gm = this._shadow.getElementById('general-messages');
    if (gm) gm.scrollTop = gm.scrollHeight;
    const tm = this._shadow.getElementById('thread-messages');
    if (tm) tm.scrollTop = tm.scrollHeight;
  }

  _renderPlaceholder(msg) {
    const root = this._shadow.getElementById('root');
    if (root) root.innerHTML = `<div class="placeholder">${this._esc(msg)}</div>`;
  }

  _renderMessages(messages, thread, agentState) {
    const isGeneral = thread === 'general';
    const parts = [];
    let prevRole = null;

    if (!messages || messages.length === 0) {
      if (agentState === 'working') parts.push(this._thinkingBubble());
      else parts.push('<div class="empty-msg">No messages yet</div>');
      return parts.join('');
    }

    for (const msg of messages) {
      const { role, content, timestamp, toolName, from } = msg;
      const isPending = !!msg._pending;
      const time  = timestamp ? this._formatTime(timestamp) : '';
      const isFirst = role !== prevRole;
      prevRole = role;

      if (role === 'tool') {
        const preview = typeof content === 'string'
          ? content.slice(0, 120) + (content.length > 120 ? '…' : '')
          : JSON.stringify(content).slice(0, 120) + '…';
        parts.push(`
          <div class="msg msg--tool">
            <span class="tool-icon">&#x2699;</span>
            <span class="tool-name">${this._esc(toolName || 'tool')}</span>
            <span class="tool-content">${this._esc(preview)}</span>
            ${time ? `<span class="msg-time">${time}</span>` : ''}
          </div>
        `);
        continue;
      }

      const isUser    = role === 'user';
      const isHuman   = !from || from === 'human';
      const label     = isUser
        ? (isHuman ? 'You' : from)
        : (this._agentName || 'Assistant');
      const roleClass = isUser
        ? (isPending ? 'msg--user msg--pending' : 'msg--user')
        : 'msg--assistant';
      const text      = this._renderContent(content, role);
      const threadKey = isGeneral && !isPending ? this._esc(this._threadKey(content)) : '';
      const replyBtn  = isGeneral && threadKey
        ? `<button class="reply-in-thread-btn" data-key="${threadKey}" title="Reply in thread">↩ Thread</button>`
        : '';

      if (isFirst) {
        parts.push(`
          <div class="msg-group">
            <div class="msg-meta">
              <span class="msg-label ${isUser ? 'label--user' : 'label--agent'}">${this._esc(label)}</span>
              ${time ? `<span class="msg-time">${time}</span>` : ''}
              ${replyBtn}
            </div>
            <div class="msg ${roleClass}">${text}</div>
          </div>
        `);
      } else {
        parts.push(`<div class="msg ${roleClass} msg--cont">${text}</div>`);
      }
    }

    // Show thinking indicator when last real message is from user and agent is processing
    const lastMsg = messages[messages.length - 1];
    const hasPending = messages.some(m => m._pending);
    if (!hasPending && agentState === 'working' && lastMsg?.role === 'user') {
      parts.push(this._thinkingBubble());
    }

    return parts.join('');
  }

  _thinkingBubble() {
    return `<div class="msg-group"><div class="msg msg--assistant msg--thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div></div>`;
  }

  _renderContent(content, role) {
    let text = '';
    if (Array.isArray(content)) {
      text = content.map(c => (typeof c === 'string' ? c : (c.text || c.content || JSON.stringify(c)))).join('\n');
    } else {
      text = String(content ?? '');
    }

    // Strip internal routing prefixes added by formatIncomingMessage before display
    if (role === 'user') {
      text = text.replace(/^\[(TASK|MESSAGE|MEETING INVITE|ESCALATION|HUMAN REPLY|TASK COMPLETE)(?:\s+from\s+[^\]]+)?\]\s*/, '');
    }

    if (role === 'assistant' && window.marked) {
      try { return window.marked.parse(text); } catch { /* fall through */ }
    }
    return `<span>${this._esc(text)}</span>`;
  }

  _formatTime(ts) {
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return ''; }
  }

  _shortKey(key) {
    if (!key) return '';
    if (key === 'general') return '# general';
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
    if (uuidRe.test(key)) return key.slice(0, 8) + '…';
    return key.length > 16 ? key.slice(0, 16) + '…' : key;
  }

  _threadKey(content) {
    let text = '';
    if (Array.isArray(content)) {
      text = content.map(c => typeof c === 'string' ? c : (c.text || c.content || '')).join(' ');
    } else {
      text = String(content ?? '');
    }
    const words = text.trim().split(/\s+/).slice(0, 4)
      .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    return words.length >= 2 ? words.join('-') : `thread-${Date.now()}`;
  }

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Template (Shadow DOM HTML + CSS) ─────────────────────────────────────

  _template() {
    return `
      <style>
        :host { display: block; width: 100%; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .layout {
          display: flex;
          height: 100%;
          background: #1a1d21;
          color: #d1d2d3;
          overflow: hidden;
        }

        /* ── Left panel ── */
        .left-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #2e3338;
          min-width: 0;
          overflow: hidden;
        }

        /* ── Right panel ── */
        .right-panel {
          width: 40%;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ── Panel header ── */
        .panel-header {
          padding: 10px 14px;
          font-size: 13px;
          font-weight: 600;
          color: #d1d2d3;
          border-bottom: 1px solid #2e3338;
          background: #1a1d21;
          flex-shrink: 0;
        }
        .panel-header--right {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .panel-close {
          background: none;
          border: none;
          color: #9a9d9f;
          cursor: pointer;
          font-size: 14px;
          padding: 2px 6px;
          border-radius: 4px;
          line-height: 1;
        }
        .panel-close:hover { background: #222529; color: #d1d2d3; }

        /* ── Scrollable message area ── */
        .messages-area {
          flex: 1;
          overflow-y: auto;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          scrollbar-width: thin;
          scrollbar-color: #3e4146 transparent;
        }
        .messages-area::-webkit-scrollbar { width: 5px; }
        .messages-area::-webkit-scrollbar-thumb { background: #3e4146; border-radius: 3px; }

        /* ── Message groups ── */
        .msg-group { margin-top: 10px; }
        .msg-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
        .msg-label { font-size: 13px; font-weight: 600; }
        .label--user  { color: #e8a838; }
        .label--agent { color: #36c5f0; }
        .msg-time { font-size: 11px; color: #666; opacity: 0; transition: opacity 0.15s; }
        .msg-group:hover .msg-time,
        .msg--cont:hover .msg-time { opacity: 1; }

        /* ── Reply in thread button ── */
        .reply-in-thread-btn {
          background: none;
          border: none;
          color: #72767d;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 3px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s;
          margin-left: auto;
          flex-shrink: 0;
        }
        .msg-group:hover .reply-in-thread-btn { opacity: 1; }
        .reply-in-thread-btn:hover { background: #2e3338; color: #d1d2d3; }

        /* ── Bubbles ── */
        .msg {
          font-size: 13px;
          line-height: 1.5;
          padding: 1px 0;
          color: #d1d2d3;
          word-break: break-word;
        }
        .msg--cont { padding-left: 0; margin-top: 2px; }
        .msg p { margin: 0 0 6px; }
        .msg p:last-child { margin-bottom: 0; }
        .msg pre { background: #111316; padding: 8px 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; margin: 4px 0; }
        .msg code { background: #111316; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
        .msg pre code { background: none; padding: 0; }

        /* ── Tool messages ── */
        .msg--tool {
          display: flex;
          align-items: baseline;
          gap: 5px;
          font-size: 11px;
          font-family: 'SF Mono', 'Fira Code', monospace;
          color: #7ab4e0;
          padding: 2px 0;
          opacity: 0.75;
        }
        .tool-icon { font-size: 11px; }
        .tool-name { font-weight: 600; flex-shrink: 0; }
        .tool-content { color: #8fa8c0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg--tool .msg-time { margin-left: auto; }

        /* ── Threads section ── */
        .threads-section {
          border-top: 1px solid #2e3338;
          padding: 8px 0 4px;
          flex-shrink: 0;
        }
        .threads-divider {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px 4px;
        }
        .threads-divider span {
          font-size: 11px;
          font-weight: 600;
          color: #72767d;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .thread-item {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 14px;
          cursor: pointer;
          font-size: 13px;
          color: #b9bbbe;
          transition: background 0.1s;
        }
        .thread-item:hover { background: #222529; color: #d1d2d3; }
        .thread-item--active { background: #1164a3; color: #fff; }
        .thread-item--active:hover { background: #1164a3; }
        .thread-icon { font-size: 12px; }
        .thread-key { flex: 1; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
        .thread-count { font-size: 11px; color: #72767d; flex-shrink: 0; }
        .thread-item--active .thread-count { color: rgba(255,255,255,0.65); }
        .thread-arrow { font-size: 12px; color: #72767d; }
        .thread-item--active .thread-arrow { color: rgba(255,255,255,0.65); }

        /* ── Compose bar ── */
        .compose-bar {
          flex-shrink: 0;
          padding: 8px 12px 10px;
          border-top: 1px solid #2e3338;
          background: #1a1d21;
        }
        .thread-name-input {
          width: 100%;
          background: #222529;
          border: 1px solid #3e4146;
          border-radius: 4px;
          color: #d1d2d3;
          font-size: 12px;
          font-family: inherit;
          padding: 5px 8px;
          margin-bottom: 6px;
          outline: none;
        }
        .thread-name-input:focus { border-color: #1164a3; }
        .thread-name-input::placeholder { color: #72767d; }
        .compose-input {
          width: 100%;
          min-height: 32px;
          max-height: 120px;
          background: #222529;
          border: 1px solid #3e4146;
          border-radius: 4px;
          color: #d1d2d3;
          font-size: 13px;
          font-family: inherit;
          padding: 6px 8px;
          resize: none;
          outline: none;
          overflow-y: auto;
          line-height: 1.4;
          display: block;
        }
        .compose-input:focus { border-color: #1164a3; }
        .compose-input::placeholder { color: #72767d; }
        .compose-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 6px;
        }
        .compose-send-btn {
          background: #1164a3;
          border: none;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 14px;
          border-radius: 4px;
          cursor: pointer;
          line-height: 1.6;
        }
        .compose-send-btn:hover { background: #1472b7; }
        .compose-send-btn--busy,
        .compose-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .new-thread-btn {
          background: none;
          border: 1px solid #3e4146;
          color: #9a9d9f;
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          line-height: 1.5;
        }
        .new-thread-btn:hover { border-color: #72767d; color: #d1d2d3; }
        .new-thread-btn--active { border-color: #b84444; color: #b84444; }
        .new-thread-btn--active:hover { border-color: #d15555; color: #d15555; }

        /* ── Pending / thinking ── */
        .msg--pending { opacity: 0.55; }
        .msg--thinking {
          display: flex;
          gap: 5px;
          align-items: center;
          padding: 10px 12px;
          min-height: 38px;
        }
        .thinking-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #72767d;
          animation: thinking-pulse 1.2s ease-in-out infinite;
        }
        .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
        .thinking-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes thinking-pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.9); }
          40%            { opacity: 1;   transform: scale(1.15); }
        }

        /* ── Misc ── */
        .placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #72767d;
          font-size: 14px;
        }
        .empty-msg {
          color: #72767d;
          font-size: 13px;
          padding: 8px 0;
        }
      </style>
      <div id="root" style="height:100%"><div class="placeholder">Loading…</div></div>
    `;
  }
}

customElements.define('conversation-threads', ConversationThreads);
