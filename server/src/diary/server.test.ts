import { describe, it, expect } from 'vitest';
import { handleCall, toolsFor, withFrontMatter, type DiaryOptions } from './server.js';

interface Seen { method: string; url: string; auth: string | null; body: unknown }

/** A diary site that answers every request with one canned response, and records what it was asked. */
function site(status: number, body: unknown) {
  const seen: Seen[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    seen.push({
      method: init.method ?? 'GET', url,
      auth: new Headers(init.headers).get('authorization'),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  const options: DiaryOptions = { baseUrl: 'https://diary.example/', token: 't0k', fetch };
  return { seen, options };
}

const entry = { date: '2026-11-01', title: 'A turn', mood: 'wry', url: '/2026-11-01/' };

describe('the diary tools', () => {
  it('list the entries with the token', async () => {
    const { seen, options } = site(200, [entry]);
    expect(await handleCall(options, 'list_entries', {})).toContain('2026-11-01 — A turn');
    expect(seen[0]).toMatchObject({ method: 'GET', url: 'https://diary.example/api/entries', auth: 'Bearer t0k' });
  });

  it('say so when a day has no entry', async () => {
    const { options } = site(404, { error: 'No entry for that date' });
    expect(await handleCall(options, 'read_entry', { date: '2026-01-01' })).toBe('There is no entry for 2026-01-01.');
  });

  it('write an entry with the front matter it was given', async () => {
    const { seen, options } = site(201, { entry, published: { entries: 5, written: 3, removed: 0 } });
    const text = await handleCall(options, 'write_entry', { date: '2026-11-01', markdown: 'Today.', title: 'A turn', mood: 'wry' });
    expect(seen[0]).toMatchObject({ method: 'PUT', url: 'https://diary.example/api/entries/2026-11-01' });
    expect(seen[0]!.body).toEqual({ markdown: '---\ntitle: A turn\nmood: wry\n---\n\nToday.' });
    expect(text).toMatch(/^Wrote a new entry/);
  });

  it('refuse a date the site would not take, without asking it', async () => {
    const { seen, options } = site(200, {});
    await expect(handleCall(options, 'delete_entry', { date: '1 Nov' })).rejects.toThrow(/YYYY-MM-DD/);
    expect(seen).toHaveLength(0);
  });

  it('pass on what the site said when it refuses', async () => {
    const { options } = site(401, { error: 'Invalid or missing token' });
    await expect(handleCall(options, 'rebuild_site', {})).rejects.toThrow('The diary said 401: Invalid or missing token');
  });
});

describe('a diary not set up', () => {
  it('offers no tools without both the address and the token', () => {
    expect(toolsFor({ baseUrl: 'https://diary.example', token: '' })).toEqual([]);
    expect(toolsFor({ baseUrl: '', token: 't0k' })).toEqual([]);
    expect(toolsFor({ baseUrl: 'https://diary.example', token: 't0k' })).toHaveLength(5);
  });

  it('refuses a call without asking the site', async () => {
    const { seen, options } = site(200, []);
    await expect(handleCall({ ...options, token: '' }, 'list_entries', {})).rejects.toThrow(/not set up/);
    expect(seen).toHaveLength(0);
  });
});

describe('front matter', () => {
  it('leaves an entry that has its own alone', () => {
    expect(withFrontMatter('---\ntitle: Mine\n---\nx', { title: 'Other' })).toBe('---\ntitle: Mine\n---\nx');
  });

  it('adds none when nothing was given', () => {
    expect(withFrontMatter('x', {})).toBe('x');
  });
});
