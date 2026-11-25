// ── Every route the runner serves, read from its source ─────────────────────
//
// The routers are if-chains over `pathname` and `method`, so there is no table
// to ask. This reads them instead, so a test can hold the runner's OpenAPI
// spec to what the code really does: a route added without a spec entry, or a
// spec entry with no code behind it, fails the build.
//
// It understands the ways routes are written here:
//   pathname === '/api/x'
//   pathname.match(/^\/api\/x\/[^/]+\/y$/)
//   pathname.startsWith('/api/x/') && pathname.endsWith('/y')
//   pathname.startsWith('/api/x/')                      → /api/x/{}
//   const NAME = /^\/api\/x\/([^/]+)\/(a|b)$/            → /api/x/{}/a, /api/x/{}/b
// A route written some other way is invisible to it; keep to these.

export interface Route {
  /** Path with every parameter written `{}`. */
  path: string;
  /** Upper-case methods named beside it, or empty when the line names none. */
  methods: string[];
}

const METHOD = /method\s*===\s*'([A-Z]+)'/g;
const EXACT = /(?<![!\w.])pathname\s*===\s*'([^']+)'/g;
const MATCH = /(?<![!\w.])pathname\.match\(\/\^(.+?)\$\/\)/g;
const STARTS = /(?<![!\w.])pathname\.startsWith\('([^']+)'\)(?:\s*&&\s*pathname\.endsWith\('([^']+)'\))?/g;
const CONST_REGEX = /^const [A-Z_]+\s*=\s*\/\^(\\\/api\\\/.+?)\$\/;/;

/** `\/api\/x\/[^/]+` → `/api/x/{}`, one path per `(a|b)` alternative. */
export function regexToPaths(source: string): string[] {
  const plain = source
    .replace(/\(\[\^\/\]\+\)|\[\^\/\]\+/g, '{}')
    .replace(/\\\//g, '/');
  const alt = /\(([a-z|-]+)\)/.exec(plain);
  if (!alt) return [plain];
  return alt[1]!.split('|').flatMap((a) => regexToPaths(plain.replace(alt[0], a)));
}

function isRoutePath(p: string): boolean {
  return p === '/events' || (p.startsWith('/api/') && p !== '/api/{}');
}

/** The routes named on one line of source. */
export function routesInLine(line: string): Route[] {
  const methods = [...line.matchAll(METHOD)].map((m) => m[1]!);
  const paths: string[] = [];
  for (const m of line.matchAll(EXACT)) paths.push(m[1]!);
  for (const m of line.matchAll(MATCH)) paths.push(...regexToPaths(m[1]!));
  for (const m of line.matchAll(STARTS)) {
    const [, start, end] = m;
    paths.push(end ? `${start}{}${end}` : start!.endsWith('/') ? `${start}{}` : start!);
  }
  const named = CONST_REGEX.exec(line.trim());
  if (named) paths.push(...regexToPaths(named[1]!));
  return paths.filter(isRoutePath).map((path) => ({ path, methods }));
}

/** Every route in a set of source files, merged by path. */
export function routesInSources(sources: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const line of source.split('\n')) {
      for (const r of routesInLine(line)) {
        const set = out.get(r.path) ?? new Set<string>();
        r.methods.forEach((m) => set.add(m));
        out.set(r.path, set);
      }
    }
  }
  return out;
}

/** An OpenAPI path, `/api/x/{id}`, written the way the inventory writes it. */
export function normalisePath(p: string): string {
  return p.replace(/\{[^}]*\}/g, '{}');
}
