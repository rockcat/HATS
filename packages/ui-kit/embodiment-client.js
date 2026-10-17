/**
 * Browser client for the HATS Embodiment API.
 *
 * Shared by any front-end that talks to a running team. Everything that needs
 * a live agent — the roster, conversation, speech, the event stream — goes
 * through here, so a UI that does *not* need a running team has no reason to
 * import it and therefore no dependency on the Team Runner.
 *
 * `basePath` is where the Embodiment API is reachable from the browser. Apps
 * usually proxy it server-side so the browser talks to one origin and any
 * credential stays off the page.
 */

const DEFAULT_BASE = '/runner/api/embodiment/v1';

export class EmbodimentError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'EmbodimentError';
    this.status = status;
  }
}

export class EmbodimentClient {
  /**
   * @param {object} [options]
   * @param {string} [options.basePath] where the API is reachable
   * @param {(method: string, path: string, status: number) => void} [options.onRequest]
   *   called for every call, so a client can show its own traffic log
   */
  constructor({ basePath = DEFAULT_BASE, onRequest } = {}) {
    this.basePath = basePath.replace(/\/$/, '');
    this.onRequest = onRequest ?? null;
  }

  async request(method, path, body) {
    const init = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.basePath}${path}`, init);
    this.onRequest?.(method, path, response.status);

    if (response.status === 401) throw new EmbodimentError('Not authenticated to the Team Runner.', 401);
    if (response.status === 502 || response.status === 504) {
      throw new EmbodimentError('The Team Runner is not reachable.', response.status);
    }
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith('audio/')) return response.blob();

    const text = await response.text();
    const parsed = text ? safeParse(text) : null;
    if (!response.ok && response.status !== 202) {
      throw new EmbodimentError(parsed?.error ?? `HTTP ${response.status}`, response.status);
    }
    return parsed;
  }

  health()  { return this.request('GET', '/health'); }
  project() { return this.request('GET', '/project'); }

  async agents() {
    const result = await this.request('GET', '/agents');
    return result?.agents ?? [];
  }

  agent(id) { return this.request('GET', `/agents/${encodeURIComponent(id)}`); }

  async threads(id) {
    const result = await this.request('GET', `/agents/${encodeURIComponent(id)}/threads`);
    return result?.threads ?? {};
  }

  async messages(id, { thread = 'general', limit = 100, since } = {}) {
    const params = new URLSearchParams({ thread, limit: String(limit) });
    if (since) params.set('since', since);
    const result = await this.request('GET', `/agents/${encodeURIComponent(id)}/messages?${params}`);
    return result?.messages ?? [];
  }

  send(id, content, { thread = 'general', mode = 'chat', context } = {}) {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/messages`,
      { content, thread, mode, ...(context && { context }) });
  }

  assignTask(id, description, context) {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/tasks`, { description, context });
  }

  /** Synthesise speech in the agent's voice. Resolves to a WAV Blob. */
  speak(id, text) {
    return this.request('POST', `/agents/${encodeURIComponent(id)}/speech`, { text });
  }

  avatarUrl(id)     { return `${this.basePath}/agents/${encodeURIComponent(id)}/avatar`; }
  backgroundUrl(id) { return `${this.basePath}/agents/${encodeURIComponent(id)}/background`; }

  /**
   * Subscribe to the live event stream.
   * `handlers` maps event name to callback; the parsed payload is passed in.
   * Returns a function that closes the stream.
   */
  stream(handlers = {}, { agentId, deviceId } = {}) {
    const query = new URLSearchParams({
      ...(agentId ? { agentId } : {}),
      // Without this a device never hears the requests addressed to it:
      // device_request frames are filtered to the device they are for.
      ...(deviceId ? { deviceId } : {}),
    }).toString();
    const source = new EventSource(`${this.basePath}/events${query ? `?${query}` : ''}`);
    for (const [name, handler] of Object.entries(handlers)) {
      if (name === 'open' || name === 'error') { source.addEventListener(name, handler); continue; }
      source.addEventListener(name, (event) => {
        try { handler(JSON.parse(event.data), event); } catch { /* a malformed frame is skipped */ }
      });
    }
    return () => source.close();
  }

  // ── Being a device ─────────────────────────────────────────────────────────
  //
  // A browser is a device like any other: it has a camera, a microphone and a
  // clock that the runner has no route to. Declaring them turns this page into
  // somewhere the agent's tools can run.

  /**
   * Say what this client offers and what it can do for itself.
   *
   * Returns what the runner agreed, which is how a client learns where work
   * will happen — whether to embed a face here or send the picture.
   *
   * Declare only what works. The runner plans around these, so claiming a
   * capability you cannot deliver is worse than claiming none: it stops the
   * runner doing the job itself.
   */
  async declareDevice(deviceId, tools, { label, capabilities } = {}) {
    const body = await this.request('PUT', `/devices/${encodeURIComponent(deviceId)}`, {
      tools,
      ...(label ? { label } : {}),
      ...(capabilities ? { capabilities } : {}),
    });
    return body?.agreed ?? {};
  }

  /** Stop offering this device's tools. */
  withdrawDevice(deviceId) {
    return this.request('DELETE', `/devices/${encodeURIComponent(deviceId)}`);
  }

  /**
   * Answer something the runner asked this device to do.
   *
   * Always answer, including on failure: an unanswered request costs the agent
   * the full timeout before it learns nothing at all.
   */
  sendDeviceResult(requestId, { ok, result, error, image } = {}) {
    return this.request('POST', `/device-results/${encodeURIComponent(requestId)}`, {
      ok: !!ok,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(image ? { image } : {}),
    });
  }

  /** Find a running agent by name — deployed agents keep their template's name. */
  async findByName(name) {
    const needle = String(name ?? '').trim().toLowerCase();
    if (!needle) return null;
    const agents = await this.agents();
    return agents.find((a) => a.name.toLowerCase() === needle)
        ?? agents.find((a) => a.name.toLowerCase().startsWith(needle))
        ?? null;
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
