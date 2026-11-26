// ── Project Files: folders from a flat list ─────────────────────────────────
//
// The runner lists sources/, outputs/ and each ticket's folder as flat lists
// of entries ({ name, relativePath, size, modified, isDir }). This turns them
// into folders to browse, explorer-style. No imports and no DOM, so it is
// directly testable; files.js draws what it returns.
//
// The top level holds Sources, Outputs and, when any ticket has files, Ticket
// work, which is not a real folder: it gathers the TKT-… folders, which sit at
// the top of the project folder.

export const ROOT = '';
export const TICKET_WORK = '#tickets';

const LABELS = { sources: 'Sources', outputs: 'Outputs', [TICKET_WORK]: 'Ticket work' };

/** The folder an entry sits in. */
function parentOf(path) {
  const cut = path.lastIndexOf('/');
  if (cut >= 0) return path.slice(0, cut);
  return /^TKT-/i.test(path) ? TICKET_WORK : ROOT;
}

function folder(path, name, parent) {
  return { path, name, label: LABELS[path] ?? name, isDir: true, size: 0, modified: '', parent };
}

/**
 * Every folder and file, by path.
 * @param {{ sources?: object[], outputs?: object[], tickets?: { id: string, files: object[] }[] }} listing
 * @returns {Map<string, object>}
 */
export function buildIndex({ sources = [], outputs = [], tickets = [] } = {}) {
  const index = new Map();
  index.set(ROOT, folder(ROOT, 'Project', null));
  index.set('sources', folder('sources', 'sources', ROOT));
  index.set('outputs', folder('outputs', 'outputs', ROOT));
  const withFiles = tickets.filter((t) => t.files?.length);
  if (withFiles.length) index.set(TICKET_WORK, folder(TICKET_WORK, 'Ticket work', ROOT));
  for (const t of withFiles) index.set(t.id, folder(t.id, t.id, TICKET_WORK));

  for (const f of [...sources, ...outputs, ...withFiles.flatMap((t) => t.files)]) {
    const parent = parentOf(f.relativePath);
    // A file listed before its folder, or a folder the runner left out.
    if (!index.has(parent)) index.set(parent, folder(parent, parent.split('/').pop(), parentOf(parent)));
    index.set(f.relativePath, {
      path: f.relativePath, name: f.name, label: f.name, isDir: !!f.isDir,
      size: f.size ?? 0, modified: f.modified ?? '', parent,
    });
  }
  return index;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** What is in a folder: folders first, then files, each in natural name order. */
export function folderContents(index, path) {
  const items = [...index.values()].filter((e) => e.parent === path && e.path !== path);
  if (path === ROOT) return items; // Sources, Outputs, Ticket work: in that order
  return items.sort((a, b) => (a.isDir === b.isDir ? byName.compare(a.name, b.name) : a.isDir ? -1 : 1));
}

/** How many things a folder holds, for its subtitle. */
export function countIn(index, path) {
  let n = 0;
  for (const e of index.values()) if (e.parent === path && e.path !== path) n++;
  return n;
}

/** The way from the top to a folder, for the breadcrumbs. */
export function crumbs(index, path) {
  const out = [];
  for (let at = index.get(path) ? path : ROOT; at !== null && at !== undefined;) {
    const entry = index.get(at);
    if (!entry) break;
    out.unshift({ path: entry.path, label: entry.label });
    at = entry.parent;
  }
  return out;
}

/** The nearest folder that still exists, after the files have changed. */
export function existingFolder(index, path) {
  let at = path;
  while (at !== null && at !== undefined && !index.get(at)?.isDir) at = at === ROOT ? null : parentOf(at);
  return at ?? ROOT;
}

const KINDS = {
  md: 'Markdown', txt: 'Text', csv: 'CSV', json: 'JSON', pdf: 'PDF', html: 'HTML',
  png: 'PNG image', jpg: 'JPEG image', jpeg: 'JPEG image', gif: 'GIF image', webp: 'WebP image', svg: 'SVG image',
  docx: 'Word document', doc: 'Word document', xlsx: 'Excel workbook', xls: 'Excel workbook',
  pptx: 'PowerPoint', zip: 'Zip archive', js: 'JavaScript', ts: 'TypeScript', py: 'Python',
  yaml: 'YAML', yml: 'YAML', xml: 'XML', log: 'Log', mp3: 'Audio', wav: 'Audio', mp4: 'Video',
};

/** What sort of thing an entry is, in words, for the list's Type column. */
export function kindOf(entry) {
  if (entry.isDir) return 'Folder';
  const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
  return KINDS[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}
