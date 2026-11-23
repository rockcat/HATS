/** A tiny typed fetch wrapper shared by the service clients. */

export class ServiceUnavailableError extends Error {
  readonly service: string;
  readonly cause: unknown;
  constructor(service: string, baseUrl: string, cause: unknown) {
    super(`${service} at ${baseUrl} is unreachable: ${(cause as Error)?.message ?? cause}`);
    this.name = 'ServiceUnavailableError';
    this.service = service;
    this.cause = cause;
  }
}

export class ServiceResponseError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(service: string, status: number, body: unknown) {
    const message = (body as { error?: string })?.error ?? `HTTP ${status}`;
    super(`${service}: ${message}`);
    this.name = 'ServiceResponseError';
    this.status = status;
    this.body = body;
  }
}

export interface HttpClientOptions {
  service: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Sent with every request, such as the installation's runner token. */
  headers?: Record<string, string>;
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly service: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: HttpClientOptions) {
    this.service = options.service;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.headers = options.headers ?? {};
  }

  /** Returns undefined on 404 so callers can treat "missing" as a normal outcome. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
    const init: RequestInit = { method, signal: AbortSignal.timeout(this.timeoutMs), headers: { ...this.headers } };
    if (body !== undefined) {
      init.headers = { ...this.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (err) {
      throw new ServiceUnavailableError(this.service, this.baseUrl, err);
    }

    if (response.status === 404) return undefined;
    if (response.status === 204) return undefined;

    const text = await response.text();
    const parsed = text ? safeParse(text) : null;
    if (!response.ok) throw new ServiceResponseError(this.service, response.status, parsed);
    return parsed as T;
  }

  get<T>(path: string): Promise<T | undefined> { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown): Promise<T | undefined> { return this.request<T>('POST', path, body); }
  put<T>(path: string, body?: unknown): Promise<T | undefined> { return this.request<T>('PUT', path, body); }
  patch<T>(path: string, body?: unknown): Promise<T | undefined> { return this.request<T>('PATCH', path, body); }
  del<T>(path: string): Promise<T | undefined> { return this.request<T>('DELETE', path); }

  /** True when the service answers its health probe. */
  async isHealthy(healthPath = '/api/v1/health'): Promise<boolean> {
    try {
      const health = await this.get<{ ok?: boolean }>(healthPath);
      return health?.ok === true;
    } catch {
      return false;
    }
  }
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
