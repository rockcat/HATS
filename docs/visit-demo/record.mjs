// Records the visit demo: Website on the left, Insights on the right, as Wren
// asks to visit, is approved, works at Insights and comes home with the
// result. Real agents do the work, so it costs model calls and takes minutes;
// the long waits are cut from the video (see record-cuts.mjs).
//
//   node --env-file=.env docs/visit-demo/record.mjs            cut the waits
//   node --env-file=.env docs/visit-demo/record.mjs --real-time
//
// Needs the demo running and seeded (README.md), Chrome, and ffmpeg. Writes
// docs/visit-demo/recording/: visit-demo.mp4, the two raw recordings, and
// timeline.json.

import { chromium } from 'playwright-core';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepSegments, laterText } from './record-cuts.mjs';
import { sideBySide } from './record-video.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'recording');
const SIZE = { width: 1120, height: 720 };
const trim = (u) => u.replace(/\/+$/, '');
const TEAMS = {
  website: { name: 'Website', url: trim(process.env['WEBSITE_RUNNER_URL'] ?? 'http://localhost:3071') },
  insights: { name: 'Insights', url: trim(process.env['INSIGHTS_RUNNER_URL'] ?? 'http://localhost:3072') },
};
const AGENT = 'Wren';
const ASK = 'Pick up the pricing-page ticket. Insights has the sales data: ask to visit them.';
const realTime = process.argv.includes('--real-time');

const t0 = Date.now();
const now = () => Date.now() - t0;
const waits = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (text) => console.log(`${(now() / 1000).toFixed(0).padStart(4)}s  ${text}`);

/** The caption bar, and the team's name in the corner, on every page load. */
function overlay(team) {
  window.__caption = (text) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:86%;'
        + 'padding:12px 20px;border-radius:10px;background:rgba(10,14,20,.88);color:#fff;font:600 20px/1.35 system-ui,sans-serif;'
        + 'text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.45);transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = text ? '1' : '0';
  };
  addEventListener('DOMContentLoaded', () => {
    const badge = document.createElement('div');
    badge.textContent = team;
    badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;padding:4px 12px;border-radius:6px;'
      + 'background:#1f6feb;color:#fff;font:700 15px system-ui,sans-serif;letter-spacing:.04em';
    document.body.appendChild(badge);
  });
}

async function open(browser, team) {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const login = await context.request.post(`${team.url}/api/auth/login`, {
    data: { username: process.env['HATS_ADMIN_USERNAME'] ?? 'admin', password: process.env['HATS_ADMIN_PASSWORD'] ?? 'changeme' },
  }).catch((err) => ({ ok: () => false, status: () => err.message }));
  if (!login.ok()) throw new Error(`Could not sign in to ${team.name} at ${team.url} (${login.status()}). Is the demo running?`);
  await context.addInitScript(overlay, team.name.toUpperCase());
  const page = await context.newPage();
  const offset = now();
  await page.goto(team.url);
  await page.waitForSelector('#side-nav');
  const api = async (p) => (await context.request.get(team.url + p)).json();
  return { ...team, context, page, offset, api };
}

const caption = (side, text) => side.page.evaluate((t) => window.__caption?.(t), text).catch(() => {});
const show = (side, view) => side.page.click(`.side-nav-item[data-view="${view}"]`);

/** Wait for `test` to return something, noting the wait so it can be cut. */
async function until(label, test, { timeout, every = 3000, sides = [] }) {
  const from = now();
  log(`waiting: ${label}`);
  for (;;) {
    const found = await test().catch(() => null);
    if (found) {
      const took = now() - from;
      waits.push({ from, to: now(), label });
      if (took > 10_000) for (const s of sides) await caption(s, laterText(took));
      log(`done after ${(took / 1000).toFixed(0)}s: ${label}`);
      return found;
    }
    if (now() - from > timeout) {
      waits.push({ from, to: now(), label });
      throw new Error(`Gave up after ${timeout / 60_000} min waiting for: ${label}`);
    }
    await sleep(every);
  }
}

/**
 * Wren's visit from Website to Insights, made after the recording began:
 * the first one, then that one by its id. Back with a partial result, Wren
 * may ask again, and that second request must not stand in for the first.
 */
let visitId = null;
async function wrensVisit(insights) {
  const started = new Date(t0).toISOString();
  const { visits = [] } = await insights.api('/api/visits');
  if (visitId) return visits.find((v) => v.id === visitId) ?? null;
  const first = visits
    .filter((v) => v.agent?.name === AGENT && (v.history?.[0]?.at ?? '') >= started)
    .sort((a, b) => (a.history[0].at < b.history[0].at ? -1 : 1))[0];
  if (first) visitId = first.id;
  return first ?? null;
}

/**
 * Before recording anything: can Wren ask to visit at all? Without the runner
 * manager it is never offered request_visit, and would wait forever.
 */
async function preflight(website) {
  const { rows = [] } = await website.api(`/api/agents/${AGENT}/tools`);
  const names = rows.map((r) => r.name);
  if (!names.includes('request_visit')) {
    throw new Error(`${AGENT} has no request_visit tool. Is the runner manager running, and RUNNER_MANAGER_URL set for the demo runners?`);
  }
}

async function demo(website, insights) {
  await preflight(website);
  const ticket = ((await website.api('/api/kanban/tickets')).tickets ?? []).find((t) => /pricing page/i.test(t.title));
  if (!ticket) throw new Error('The pricing-page ticket is missing from Website. Run seed.mjs first.');

  // 1. Two teams: one with the work, one with the data.
  await show(website, 'board');
  await caption(website, `Website's ticket for ${AGENT}: the pricing page needs real sales numbers`);
  await show(insights, 'files');
  await insights.page.dblclick('.files-item[data-path="sources"]');
  await insights.page.click('.files-items .files-item:has-text(".csv")');
  await caption(insights, 'Insights has the sales data, and it stays here');
  await sleep(6000);

  // 2. Ask Wren to pick it up.
  await show(website, 'cli');
  await website.page.selectOption('#chat-agent-select', AGENT);
  await caption(website, `We ask ${AGENT} to pick up the ticket`);
  const box = website.page.locator('#chat-threads .compose-input').first();
  await box.pressSequentially(ASK, { delay: 25 });
  await box.press('Enter');
  await show(insights, 'visits');
  await caption(insights, 'Insights waits. No one can visit without asking');

  // 3. Wren asks to visit; an admin at Insights decides.
  let visit = await until('Wren asks to visit Insights', () => wrensVisit(insights), { timeout: 8 * 60_000, sides: [website, insights] });
  await caption(website, `${AGENT} asks to visit Insights, saying why and what it will bring back`);
  if (visit.state === 'requested') {
    await show(insights, 'visits');
    const approve = insights.page.locator('.visit-btn', { hasText: 'Approve' }).first();
    await approve.waitFor({ timeout: 20_000 });
    await caption(insights, `${AGENT} is asking to visit. An admin here decides`);
    await sleep(5000);
    await approve.click();
    await caption(insights, 'Approved');
  }

  // 4. Wren leaves Website and arrives at Insights.
  visit = await until('Wren arrives at Insights', async () => ((await wrensVisit(insights))?.state === 'visiting' ? true : null),
    { timeout: 4 * 60_000, sides: [website, insights] });
  await show(website, 'agents');
  await caption(website, `${AGENT} has left Website`);
  await show(insights, 'agents');
  await caption(insights, `${AGENT} has arrived at Insights, beside Iris`);
  await sleep(6000);
  await show(website, 'visits');
  await caption(website, `Website can see where ${AGENT} is, and when it must be back`);
  await show(insights, 'board');
  await caption(insights, `${AGENT} works on a ticket of its own here, reading the sales file`);

  // 5. Wren finishes, and comes home with the result.
  await until('Wren comes home', async () => ((await wrensVisit(insights))?.state === 'home' ? true : null),
    { timeout: 15 * 60_000, every: 5000, sides: [website, insights] });
  await show(website, 'agents');
  await caption(website, `${AGENT} is home`);
  await show(insights, 'agents');
  await caption(insights, `${AGENT} has gone home. Insights keeps its data`);
  await sleep(5000);
  await until('The result is on the ticket', async () => {
    const t = ((await website.api('/api/kanban/tickets')).tickets ?? []).find((x) => x.id === ticket.id);
    return t?.comments?.some((c) => /result of the visit/i.test(c.text)) ? true : null;
  }, { timeout: 2 * 60_000, sides: [website] });
  await show(website, 'board');
  await website.page.locator(`[data-ticket-id="${ticket.id}"]`).first().click();
  await caption(website, `The result comes home as a comment on ${ticket.id}`);
  await website.page.evaluate(() => document.querySelector('#modal-comments, .modal-comments')?.scrollIntoView?.({ block: 'end' }));
  await show(insights, 'files');
  await caption(insights, 'The sales file never left Insights');
  await sleep(8000);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env['DEMO_BROWSER'] ?? 'chrome' });
  const website = await open(browser, TEAMS.website);
  const insights = await open(browser, TEAMS.insights);
  let failure = null;
  try {
    await demo(website, insights);
  } catch (err) {
    failure = err;
    log(`stopped: ${err.message}`);
    for (const s of [website, insights]) await caption(s, `Stopped: ${err.message}`);
    await sleep(4000);
  }
  const total = now();
  const raw = {};
  for (const [key, side] of [['website', website], ['insights', insights]]) {
    const video = side.page.video();
    await side.context.close();
    raw[key] = path.join(OUT, `raw-${key}.webm`);
    await rename(await video.path(), raw[key]);
  }
  await browser.close();

  const keep = realTime ? [{ start: 0, end: total }] : keepSegments(waits, total);
  await writeFile(path.join(OUT, 'timeline.json'), JSON.stringify({ total, offsets: { website: website.offset, insights: insights.offset }, waits, keep }, null, 2));
  const out = path.join(OUT, 'visit-demo.mp4');
  log('making the video…');
  await sideBySide({
    left: { path: raw.website, offset: website.offset },
    right: { path: raw.insights, offset: insights.offset },
    keep, out,
  });
  const kept = keep.reduce((s, k) => s + k.end - k.start, 0);
  log(`${out}: ${(kept / 1000).toFixed(0)}s of ${(total / 1000).toFixed(0)}s recorded`);
  if (failure) process.exitCode = 1;
}

await main();
