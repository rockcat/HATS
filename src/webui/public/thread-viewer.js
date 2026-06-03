// thread-viewer.js — <conversation-threads agent="Name"> web component
// Slack-style two-column threaded conversation viewer

class ConversationThreads extends HTMLElement {
  static get observedAttributes() { return ['agent']; }

  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
    this._agentName = null;
    this._threads = {};
    this._generalMessages = [];
    this._activeThread = null;
    this._activeMessages = [];
    this._pollTimer = null;
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
      this._refresh();
    }
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._refresh(), 15000);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  // ── Data fetching ────────────────────────────────────────────────────────

  async _refresh() {
    if (!this._agentName) { this._renderPlaceholder('No agent selected'); return; }
    try {
      const threadsRes = await fetch(`/api/agents/${encodeURIComponent(this._agentName)}/threads`);
      if (!threadsRes.ok) { this._renderPlaceholder('Agent not found'); return; }
      this._threads = await threadsRes.json();
      await this._loadGeneral();
      if (this._activeThread) await this._loadThread(this._activeThread);
      this._render();
    } catch {
      this._renderPlaceholder('Failed to load conversation');
    }
  }

  async _loadGeneral() {
    const res = await fetch(`/api/agents/${encodeURIComponent(this._agentName)}/history?thread=general`);
    this._generalMessages = res.ok ? await res.json() : [];
  }

  async _loadThread(key) {
    const res = await fetch(`/api/agents/${encodeURIComponent(this._agentName)}/history?thread=${encodeURIComponent(key)}`);
    this._activeMessages = res.ok ? await res.json() : [];
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    this._shadow.addEventListener('click', e => {
      const item = e.target.closest('.thread-item');
      if (item) { this._openThread(item.dataset.key); return; }
      const close = e.target.closest('.panel-close');
      if (close) { this._closeThread(); }
    });
  }

  async _openThread(key) {
    this._activeThread = key;
    await this._loadThread(key);
    this._render();
  }

  _closeThread() {
    this._activeThread = null;
    this._activeMessages = [];
    this._render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render() {
    const root = this._shadow.getElementById('root');
    if (!root) return;

    const nonGeneral = Object.entries(this._threads).filter(([k]) => k !== 'general');
    const rightOpen = !!this._activeThread;

    root.innerHTML = `
      <div class="layout${rightOpen ? ' layout--split' : ''}">
        <div class="left-panel">
          <div class="panel-header"># general</div>
          <div class="messages-area" id="general-messages">
            ${this._renderMessages(this._generalMessages, 'general')}
          </div>
          ${nonGeneral.length ? `
          <div class="threads-section">
            <div class="threads-divider">Threads</div>
            ${nonGeneral.map(([k, count]) => `
              <div class="thread-item${this._activeThread === k ? ' thread-item--active' : ''}" data-key="${this._esc(k)}">
                <span class="thread-icon">&#x1f9f5;</span>
                <span class="thread-key">${this._shortKey(k)}</span>
                <span class="thread-count">${count} msg${count !== 1 ? 's' : ''}</span>
                <span class="thread-arrow">&#8594;</span>
              </div>
            `).join('')}
          </div>` : ''}
        </div>
        ${rightOpen ? `
        <div class="right-panel">
          <div class="panel-header panel-header--right">
            <span>Thread: ${this._shortKey(this._activeThread)}</span>
            <button class="panel-close" title="Close">&#x2715;</button>
          </div>
          <div class="messages-area" id="thread-messages">
            ${this._renderMessages(this._activeMessages, this._activeThread)}
          </div>
        </div>` : ''}
      </div>
    `;

    // Scroll both panels to bottom
    const gm = this._shadow.getElementById('general-messages');
    if (gm) gm.scrollTop = gm.scrollHeight;
    const tm = this._shadow.getElementById('thread-messages');
    if (tm) tm.scrollTop = tm.scrollHeight;
  }

  _renderPlaceholder(msg) {
    const root = this._shadow.getElementById('root');
    if (root) root.innerHTML = `<div class="placeholder">${this._esc(msg)}</div>`;
  }

  _renderMessages(messages, _thread) {
    if (!messages || messages.length === 0) {
      return '<div class="empty-msg">No messages yet</div>';
    }

    const parts = [];
    let prevRole = null;

    for (const msg of messages) {
      const { role, content, timestamp, toolName } = msg;
      const time = timestamp ? this._formatTime(timestamp) : '';
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

      const isUser = role === 'user';
      const label = isUser ? 'You' : (this._agentName || 'Assistant');
      const roleClass = isUser ? 'msg--user' : 'msg--assistant';
      const text = this._renderContent(content, role);

      if (isFirst) {
        parts.push(`
          <div class="msg-group">
            <div class="msg-meta">
              <span class="msg-label ${isUser ? 'label--user' : 'label--agent'}">${this._esc(label)}</span>
              ${time ? `<span class="msg-time">${time}</span>` : ''}
            </div>
            <div class="msg ${roleClass}">${text}</div>
          </div>
        `);
      } else {
        // Append continuation to last group — close last group div, add new content, reopen
        // Simpler: just use a continuation div
        parts.push(`<div class="msg ${roleClass} msg--cont">${text}</div>`);
      }
    }

    return parts.join('');
  }

  _renderContent(content, role) {
    let text = '';
    if (Array.isArray(content)) {
      text = content.map(c => (typeof c === 'string' ? c : (c.text || c.content || JSON.stringify(c)))).join('\n');
    } else {
      text = String(content ?? '');
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
    // UUID pattern: xxxxxxxx-xxxx-... → show first 8 chars + ellipsis
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
    if (uuidRe.test(key)) return key.slice(0, 8) + '…';
    // Otherwise truncate at 16
    return key.length > 16 ? key.slice(0, 16) + '…' : key;
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
          width: 380px;
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
          padding: 8px 0 6px;
          flex-shrink: 0;
        }
        .threads-divider {
          font-size: 11px;
          font-weight: 600;
          color: #72767d;
          padding: 0 14px 4px;
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
          border-radius: 0;
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
