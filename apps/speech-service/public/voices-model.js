// ── Shaping the voice lists ──────────────────────────────────────────────────
//
// Pure functions over the catalogue, so the page's logic can be tested
// without a browser. app.js does the wiring.

/** "63 MB" — models are tens of megabytes, so whole megabytes are enough. */
export function formatSize(bytes) {
  if (!bytes) return '';
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${Math.round(bytes / 1e6)} MB`;
}

/** Languages present in the catalogue, for the filter: [{ code, label }] by label. */
export function languagesOf(voices) {
  const byCode = new Map();
  for (const v of voices) {
    if (!byCode.has(v.languageCode)) byCode.set(v.languageCode, `${v.language} (${v.country})`);
  }
  return [...byCode].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The voices still to install that match the filter. */
export function filterAvailable(voices, { query = '', language = '', quality = '' } = {}) {
  const q = query.trim().toLowerCase();
  return voices.filter((v) => !v.installed
    && (!language || v.languageCode === language)
    && (!quality || v.quality === quality)
    && (!q || v.name.toLowerCase().includes(q) || v.language.toLowerCase().includes(q)
      || v.country.toLowerCase().includes(q)));
}

/**
 * The installed voices, described from the catalogue where it knows them.
 * A voice put in the folder by hand may not be in the catalogue; it is
 * listed all the same, by name.
 */
export function describeInstalled(running, catalogue) {
  const known = new Map(catalogue.map((v) => [v.name, v]));
  const runningNames = new Set(running.map((v) => v.name));
  const names = new Set([...runningNames, ...catalogue.filter((v) => v.installed).map((v) => v.name)]);
  return [...names].sort().map((name) => {
    const live = running.find((v) => v.name === name);
    return {
      name,
      ...(known.get(name) ?? {}),
      speakerCount: live?.speakers?.length || known.get(name)?.speakers || 1,
      // Only a running voice can be asked for a speaker, so only it has these.
      speakerNames: (live?.speakers ?? []).map((s) => s.name),
      defaultSpeaker: live?.speakers?.find((s) => s.id === live.speakerId)?.name ?? '',
      running: !!live,
    };
  });
}

/** A starting language for the filter: the browser's own, if the catalogue has it. */
export function preferredLanguage(languages, navigatorLanguage = '') {
  const wanted = navigatorLanguage.replace('-', '_');
  return languages.find((l) => l.code === wanted)?.code
    ?? languages.find((l) => l.code.split('_')[0] === wanted.split('_')[0])?.code
    ?? '';
}
