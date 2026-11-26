// ── Who the team knows ────────────────────────────────────────────────────────
//
// One file per project, not per agent. If Poppy learns who Paul is, Rhoda
// should not have to ask him again — "who is this" is a fact about the world
// rather than about one agent's relationship with him. What each agent *knows*
// about Paul still belongs in its own memory graph; this is only the mapping
// from a face to a name.
//
// Consent is enforced here rather than remembered here. A person with no
// consent is not a person with a flag set — no template is stored at all, so
// there is nothing to leak, nothing to match against, and nothing to forget
// later. That is the difference between a consent record and consent.

import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { identify, normalise, worthStoring } from './matching.js';
import type { Consent, FaceTemplate, Person, Recognition } from './types.js';

/** What the store will not hold, however it is asked. */
export class ConsentRequired extends Error {
  constructor(name: string) {
    super(`No consent recorded for ${name}. Ask before remembering a face.`);
    this.name = 'ConsentRequired';
  }
}

interface PeopleFile {
  version: 1;
  people: Person[];
}

export class PeopleStore {
  private people: Person[] = [];
  private loaded = false;

  constructor(private readonly file: string) {}

  get path(): string { return this.file; }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as PeopleFile;
      this.people = Array.isArray(parsed.people) ? parsed.people : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.people = [];
    }
    this.loaded = true;
  }

  private async ready(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  /** Temp file then rename, so a crash does not leave half a register. */
  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const body: PeopleFile = { version: 1, people: this.people };
    await writeFile(temp, JSON.stringify(body, null, 2), 'utf8');
    await rename(temp, this.file);
  }

  async all(): Promise<Person[]> {
    await this.ready();
    return [...this.people];
  }

  async find(id: string): Promise<Person | undefined> {
    await this.ready();
    return this.people.find((p) => p.id === id);
  }

  async findByName(name: string): Promise<Person | undefined> {
    await this.ready();
    const wanted = name.trim().toLowerCase();
    return this.people.find((p) => p.name.toLowerCase() === wanted);
  }

  /** Who this agent belongs to, if anybody has been named. */
  async primary(): Promise<Person | undefined> {
    await this.ready();
    return this.people.find((p) => p.primary);
  }

  /**
   * Who is this?
   *
   * Updates `lastSeenAt` on a confident match, which is what makes "you have
   * not seen Rhoda in a month" answerable later.
   */
  async identify(probe: number[], model: string, options: { threshold?: number; margin?: number } = {}): Promise<Recognition> {
    await this.ready();
    const result = identify(this.people, normalise(probe), { model, ...options });
    if (result.outcome === 'known') {
      result.person.lastSeenAt = new Date().toISOString();
      await this.persist();
    }
    return result;
  }

  /**
   * Remember somebody, with their consent.
   *
   * Refuses rather than storing an unconsented template: the point of asking
   * is that "no" has an effect.
   */
  async remember(
    name: string, vector: number[], model: string, consent: Consent,
    options: { primary?: boolean; notes?: string } = {},
  ): Promise<Person> {
    await this.ready();
    if (!consent.granted) throw new ConsentRequired(name);

    const template: FaceTemplate = {
      model,
      dimensions: vector.length,
      vector: normalise(vector),
      addedAt: new Date().toISOString(),
    };

    const existing = await this.findByName(name);
    if (existing) {
      // Only keep a template that adds something. A near-duplicate teaches
      // nothing; one that looks like somebody else is a mis-enrolment.
      if (worthStoring(existing, template.vector, model)) existing.templates.push(template);
      existing.lastSeenAt = new Date().toISOString();
      if (options.notes) existing.notes = options.notes;
      if (options.primary !== undefined) await this.setPrimaryOn(existing, options.primary);
      await this.persist();
      return existing;
    }

    const person: Person = {
      id: randomUUID(),
      name: name.trim(),
      templates: [template],
      consent,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...(options.notes ? { notes: options.notes } : {}),
    };
    this.people.push(person);
    if (options.primary) await this.setPrimaryOn(person, true);
    await this.persist();
    return person;
  }

  /** There is one main user, so naming a new one stands the old one down. */
  private async setPrimaryOn(person: Person, primary: boolean): Promise<void> {
    if (!primary) { delete person.primary; return; }
    for (const other of this.people) delete other.primary;
    person.primary = true;
  }

  async setPrimary(id: string): Promise<Person | null> {
    const person = await this.find(id);
    if (!person) return null;
    await this.setPrimaryOn(person, true);
    await this.persist();
    return person;
  }

  /**
   * Forget somebody entirely.
   *
   * Removed, not flagged. A right to be forgotten that leaves the face behind
   * is not one, and a "deleted" template still matches.
   */
  async forget(idOrName: string): Promise<Person | null> {
    await this.ready();
    const wanted = idOrName.trim().toLowerCase();
    const at = this.people.findIndex(
      (p) => p.id === idOrName || p.name.toLowerCase() === wanted,
    );
    if (at < 0) return null;
    const [gone] = this.people.splice(at, 1);
    await this.persist();
    return gone ?? null;
  }

  /** Drop every template from a model, e.g. after changing models. */
  async forgetModel(model: string): Promise<number> {
    await this.ready();
    let removed = 0;
    for (const person of this.people) {
      const before = person.templates.length;
      person.templates = person.templates.filter((t) => t.model !== model);
      removed += before - person.templates.length;
    }
    if (removed > 0) await this.persist();
    return removed;
  }
}

/** Everything but the biometrics, for showing a human who is on file. */
export function withoutTemplates(person: Person): Omit<Person, 'templates'> & { faces: number } {
  const { templates, ...rest } = person;
  return { ...rest, faces: templates.length };
}
