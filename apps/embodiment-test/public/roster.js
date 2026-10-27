/**
 * Painting the roster. The merge itself is in `roster-model.js`, which has no
 * DOM and no imports so it can be tested on its own.
 */

import { clear, el, hatDots } from '/ui-kit/hats-ui.js';
import { subtitleFor } from '/roster-model.js';

export { filterRoster, mergeRoster } from '/roster-model.js';

export function renderRoster(list, empty, count, rows, { selectedKey, onSelect }) {
  count.textContent = String(rows.length);
  empty.hidden = rows.length > 0;
  clear(list);

  for (const row of rows) {
    list.append(el('li', {
      'aria-selected': row.key === selectedKey,
      class: row.live ? 'live' : 'dormant',
      onclick: () => onSelect(row),
    },
      el('span', { class: 'hats' }, ...hatDots(row.hats)),
      el('span', { class: 'grow' },
        el('div', { class: 'name' }, row.name),
        el('div', { class: 'meta' }, subtitleFor(row)),
      ),
      el('span', { class: 'badges' },
        row.identity.voice ? el('span', { class: 'tag', title: `voice: ${row.identity.voice}` }, '🔊') : null,
        row.identity.avatar ? el('span', { class: 'tag', title: `avatar: ${row.identity.avatar}` }, '🙂') : null,
        row.live
          ? el('span', { class: 'tag ok', title: 'Deployed — the Embodiment API can talk to it' }, 'live')
          : el('span', { class: 'tag', title: 'In the Agent Template Library but not deployed' }, 'lib'),
      ),
    ));
  }
}
