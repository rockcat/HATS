// ── Run a scheduled task now, to try it ────────────────────────────────────────
//
// A test run fires the task exactly as the schedule would, but leaves the
// schedule alone. What happened is shown under the row: whether the agent was
// messaged, and for a tool call what the tool returned — which is what you
// need to check a condition against.

const RESULT_CHARS = 300;

/** One run's outcome in words. `who` names the agent when there may be several. */
export function describeRun(outcome, who = '') {
  const to = who ? ` ${who}` : '';
  if (outcome.error) return `✗${to ? `${to}:` : ''} ${outcome.error}`;
  const result = outcome.result === undefined ? ''
    : ` Tool returned: ${outcome.result.length > RESULT_CHARS ? outcome.result.slice(0, RESULT_CHARS) + '…' : outcome.result}`;
  return outcome.delivered
    ? `✓ Sent to${to || ' the agent'}.${result}`
    : `– Condition not met${to ? ` for${to}` : ''}, so no message was sent.${result}`;
}

/**
 * A "Run now" button that POSTs to `url` and hands the outcome text to
 * `show`. The endpoint answers with one outcome, or a list of them, each
 * naming its agent.
 */
export function runNowButton(url, show) {
  const btn = document.createElement('button');
  btn.className = 'library-btn';
  btn.textContent = '▶ Run now';
  btn.title = 'Run it now to test it — the schedule is not changed';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const r = await fetch(url, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) show(`✗ ${data.error ?? 'Run failed'}`, true);
      else if (Array.isArray(data)) show(data.map(o => describeRun(o, o.agentName)).join('\n'), data.some(o => o.error));
      else show(describeRun(data), Boolean(data.error));
    } catch {
      show('✗ Network error', true);
    }
    btn.disabled = false;
    btn.textContent = '▶ Run now';
  });
  return btn;
}

/** Show a run's outcome under `body`, replacing any earlier one. */
export function showRunOutcome(body, text, failed) {
  let out = body.querySelector('.run-now-outcome');
  if (!out) {
    out = document.createElement('div');
    body.appendChild(out);
  }
  out.className = 'run-now-outcome' + (failed ? ' run-now-outcome--failed' : '');
  out.textContent = text;
}
