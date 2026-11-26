// ── Team news ─────────────────────────────────────────────────────────────────
//
// A short notice when the team changes from outside this dashboard, such as
// a member added or removed in the Project Designer. It fades on its own;
// clicking it dismisses it sooner.

const SHOW_MS = 8_000;

function container() {
  let box = document.getElementById('team-news');
  if (!box) {
    box = document.createElement('div');
    box.id = 'team-news';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  return box;
}

/** Show `news`, a list of sentences, as one notice. */
export function showTeamNews(news) {
  if (!Array.isArray(news) || news.length === 0) return;
  const card = document.createElement('div');
  card.className = 'team-news-card';
  const title = document.createElement('div');
  title.className = 'team-news-title';
  title.textContent = 'Team update';
  card.appendChild(title);
  for (const item of news) {
    const line = document.createElement('div');
    line.textContent = item;
    card.appendChild(line);
  }
  const dismiss = () => card.remove();
  card.addEventListener('click', dismiss);
  container().appendChild(card);
  setTimeout(dismiss, SHOW_MS);
}
