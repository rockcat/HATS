/**
 * An agent store that can change what is behind it while the runner runs.
 *
 * At startup the runner picks the Agent Library service if it answers and a
 * local agents.json if not. Picked once, a library that came up late was never
 * used until a restart. This keeps one object for everything that holds the
 * store, and `load()` picks again: reloading the library's templates, or moving
 * to the library once it answers (or back to the local file if it has gone).
 */

import type { AgentDefinition } from '../store/team-snapshot.js';
import type { AgentDefinitionStore, AgentSecrets } from './agent-store.js';

/** Where the library's entries come from. */
export type AgentStoreSource = { kind: 'library'; url: string } | { kind: 'local' };

/** A loaded store and where it came from. */
export interface ConnectedAgentStore {
  store: AgentDefinitionStore;
  source: AgentStoreSource;
}

export class SwitchableAgentStore implements AgentDefinitionStore {
  private inner: AgentDefinitionStore | null = null;
  private current: AgentStoreSource = { kind: 'local' };
  /** The load in flight, so two refreshes at once don't race to set `inner`. */
  private loading: Promise<void> | null = null;

  /** `connect` picks and loads a store; it is called again on every `load()`. */
  constructor(private readonly connect: () => Promise<ConnectedAgentStore>) {}

  /** Where the entries come from now. */
  get source(): AgentStoreSource { return this.current; }

  load(): Promise<void> {
    this.loading ??= this.connect()
      .then(({ store, source }) => { this.inner = store; this.current = source; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  list(): AgentDefinition[] { return this.inner?.list() ?? []; }
  get(id: string): AgentDefinition | undefined { return this.inner?.get(id); }
  has(id: string): boolean { return this.inner?.has(id) ?? false; }

  addOrUpdate(def: AgentDefinition): Promise<AgentDefinition> {
    if (!this.inner) return Promise.reject(new Error('Agent store not loaded'));
    return this.inner.addOrUpdate(def);
  }

  remove(id: string): Promise<boolean> {
    return this.inner ? this.inner.remove(id) : Promise.resolve(false);
  }

  // Present only when the store behind has them. Callers test for these to
  // decide whether credentials are kept on this machine; the local file keeps
  // none, and a wrapper that always had them would claim otherwise.
  get secretsFor(): ((id: string, templateId?: string) => AgentSecrets) | undefined {
    return this.inner?.secretsFor?.bind(this.inner);
  }

  get setSecrets(): ((id: string, secrets: AgentSecrets) => Promise<void>) | undefined {
    return this.inner?.setSecrets?.bind(this.inner);
  }
}
