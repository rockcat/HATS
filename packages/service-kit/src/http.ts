/** Request/response primitives shared by every HATS service. */

import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiError, ApiErrorDetail } from '../../contracts/src/types.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Filename');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function noContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function text(res: ServerResponse, status: number, body: string, mime = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': mime, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export function binary(res: ServerResponse, status: number, body: Buffer, mime: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': mime, 'Content-Length': body.length, ...extra });
  res.end(body);
}

export function fail(res: ServerResponse, status: number, message: string, code?: string, details?: ApiErrorDetail[]): void {
  const body: ApiError = { error: message };
  if (code) body.code = code;
  if (details?.length) body.details = details;
  json(res, status, body);
}

export const notFound = (res: ServerResponse, what = 'Resource') =>
  fail(res, 404, `${what} not found`, 'not_found');

export const badRequest = (res: ServerResponse, message: string, details?: ApiErrorDetail[]) =>
  fail(res, 400, message, 'bad_request', details);

export const conflict = (res: ServerResponse, message: string) =>
  fail(res, 409, message, 'conflict');

/** Read and parse a JSON request body. Returns undefined for an empty body. */
export async function readJsonBody<T>(req: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

/** Throw from any handler to short-circuit with a specific status. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(status: number, message: string, code?: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) { res.end(); return; }
  if (err instanceof HttpError) {
    fail(res, err.status, err.message, err.code, err.details);
    return;
  }
  fail(res, 500, (err as Error)?.message ?? 'Internal error', 'internal_error');
}
