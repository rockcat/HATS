/**
 * A minimal path-pattern router.
 *
 * Patterns use `:name` segments, e.g. `/api/v1/projects/:id/team/:instanceId`.
 * A trailing `*name` segment captures the rest of the path, which is how the
 * proxy routes forward everything under a prefix.
 */

import type { IncomingMessage, ServerResponse } from 'http';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  segments: string[];
}

export function route(method: string, pattern: string, handler: Handler): Route {
  return { method, pattern, handler, segments: splitPath(pattern) };
}

export const get    = (pattern: string, handler: Handler) => route('GET', pattern, handler);
export const post   = (pattern: string, handler: Handler) => route('POST', pattern, handler);
export const put    = (pattern: string, handler: Handler) => route('PUT', pattern, handler);
export const patch  = (pattern: string, handler: Handler) => route('PATCH', pattern, handler);
export const del    = (pattern: string, handler: Handler) => route('DELETE', pattern, handler);

function splitPath(p: string): string[] {
  return p.split('/').filter(Boolean);
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    if (p.startsWith('*')) {
      params[p.slice(1) || 'rest'] = actual.slice(i).join('/');
      return params;
    }
    if (i >= actual.length) return null;
    const a = actual[i] as string;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return pattern.length === actual.length ? params : null;
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

/** Find the first route matching method and path, ignoring trailing slashes. */
export function matchRoute(routes: Route[], method: string, pathname: string): RouteMatch | null {
  const actual = splitPath(pathname);
  let pathMatched = false;
  for (const r of routes) {
    const params = matchSegments(r.segments, actual);
    if (params === null) continue;
    pathMatched = true;
    if (r.method === method) return { route: r, params };
  }
  if (pathMatched) throw new MethodNotAllowed(pathname);
  return null;
}

export class MethodNotAllowed extends Error {
  constructor(pathname: string) {
    super(`Method not allowed for ${pathname}`);
    this.name = 'MethodNotAllowed';
  }
}
