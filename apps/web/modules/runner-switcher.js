// ── Switching runners ─────────────────────────────────────────────────────────
//
// With a runner manager, each project has its own runner, and the project
// badge lists them all: choosing another project opens its runner's
// dashboard, and a project with no runner can be started from here (admins
// only). Sign-in is shared, so the other dashboard opens signed in.
//
// Without one, project.js switches projects inside this runner, as before.

const POLL_MS  = 2_000;
const START_MS = 120_000;

/** Whether this runner has a runner manager to ask. */
export async function hasRunnerManager() {
  try { return (await fetch('/api/runners')).ok; } catch { return false; }
}

/** Where a runner's dashboard is, from this page's point of view. */
function runnerUrl(runner) {
  return runner.url ?? `${location.protocol}//${location.hostname}:${runner.port}`;
}

const STATUS_LABEL = {
  running: 'running', starting: 'starting…', stopped: 'stopped', unreachable: 'not answering',
};

function message(list, text) {
  list.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'project-switcher-loading';
  div.textContent = text;
  list.appendChild(div);
}

/**
 * The project a link asks for, as in /?open=paige from the Project Designer,
 * or null. Taken out of the address so a reload does not act on it again.
 */
export function takeRequestedProject() {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('open')?.trim();
  if (!wanted) return null;
  params.delete('open');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  return wanted;
}

/**
 * Open `project`'s runner, as if it had been chosen from the badge: a running
 * one opens, one that can be launched is, and otherwise the list stays open
 * to show why not.
 */
export async function openRunnerFor(project, currentId) {
  if (project.toLowerCase() === (currentId ?? '').toLowerCase()) return;
  document.getElementById('project-switcher').hidden = false;
  await loadRunnerList(currentId);
  const row = [...document.querySelectorAll('.runner-row')]
    .find((r) => r.dataset.project?.toLowerCase() === project.toLowerCase());
  if (row?.classList.contains('runner-row--open')) row.click();
  else row?.querySelector('.runner-launch-btn')?.click();
}

/** Fill the switcher with every project and its runner. */
export async function loadRunnerList(currentId) {
  const list = document.getElementById('project-switcher-list');
  message(list, 'Loading…');
  let data;
  try {
    const res = await fetch('/api/runners');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    message(list, 'Could not reach the runner manager.');
    return;
  }
  const { projects, canLaunch } = data;
  if (!projects.length) { message(list, 'No projects found.'); return; }

  list.innerHTML = '';
  for (const project of projects) list.appendChild(projectRow(project, currentId, canLaunch));
}

function projectRow(project, currentId, canLaunch) {
  const { id, name, runner } = project;
  const row = document.createElement('div');
  row.className = 'project-switcher-row runner-row';
  row.title = id;
  row.dataset.project = id;

  const label = document.createElement('span');
  label.className = 'runner-row-name';
  label.textContent = name;
  row.appendChild(label);

  if (id.toLowerCase() === (currentId ?? '').toLowerCase()) {
    row.classList.add('active');
    return row;
  }

  const status = document.createElement('span');
  status.className = `runner-status runner-status--${runner?.status ?? 'none'}`;
  status.textContent = runner ? STATUS_LABEL[runner.status] : 'no runner';
  row.appendChild(status);

  if (runner?.status === 'running') {
    row.classList.add('runner-row--open');
    row.title = `Open ${name}'s runner on port ${runner.port}`;
    row.addEventListener('click', () => { location.href = runnerUrl(runner); });
  } else if (canLaunch && (!runner || (runner.managed && runner.status === 'stopped'))) {
    // A runner that is not answering and was not started from here is left
    // alone: if it came back, two runners would share one project.
    const launch = document.createElement('button');
    launch.className = 'project-switcher-load-btn runner-launch-btn';
    launch.textContent = 'Launch';
    launch.addEventListener('click', (e) => { e.stopPropagation(); void launchRunner(id, status, launch); });
    row.appendChild(launch);
  }
  return row;
}

/** Start a runner for `project`, wait for it to answer, then open it. */
async function launchRunner(project, status, button) {
  button.disabled = true;
  button.textContent = 'Starting…';
  status.textContent = 'starting…';
  status.className = 'runner-status runner-status--starting';

  const res = await fetch('/api/runners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  }).catch(() => null);
  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    status.textContent = 'could not start';
    status.className = 'runner-status runner-status--stopped';
    status.title = body.error ?? 'The runner manager is not answering';
    button.disabled = false;
    button.textContent = 'Retry';
    return;
  }

  // A new runner takes a few seconds to load its project and report in.
  const deadline = Date.now() + START_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const list = await fetch('/api/runners').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const runner = list?.projects.find((p) => p.id.toLowerCase() === project.toLowerCase())?.runner;
    if (runner?.status === 'running') { location.href = runnerUrl(runner); return; }
  }
  status.textContent = 'started, not answering yet';
  button.disabled = false;
  button.textContent = 'Launch';
}
