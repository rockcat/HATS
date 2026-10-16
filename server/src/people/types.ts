// ── People an agent knows ─────────────────────────────────────────────────────
//
// A face template is biometric data. Under UK GDPR that is special-category,
// which in practice means three things this design has to carry rather than
// bolt on later: it is stored only with explicit consent, who gave it and when
// is recorded, and forgetting somebody has to actually remove it.

/** One face, as a vector, tagged with the model that produced it. */
export interface FaceTemplate {
  /** Which model made it. Vectors from different models cannot be compared. */
  model: string;
  /** Length of the vector, checked rather than assumed. */
  dimensions: number;
  /** The embedding itself, L2-normalised when stored. */
  vector: number[];
  /** ISO instant it was added, so stale templates can be found later. */
  addedAt: string;
}

/** Why we are allowed to hold somebody's face. */
export interface Consent {
  granted: boolean;
  /** ISO instant they said yes. */
  at: string;
  /** Which agent asked. Useful when somebody asks why they are in here. */
  askedBy?: string;
}

export interface Person {
  id: string;
  name: string;
  /**
   * Several templates per person, not one.
   *
   * One template is one lighting condition and one angle. Recognition across a
   * room, at a different time of day, needs more than that, and the cheapest
   * way to get it is to keep adding as they are seen.
   */
  templates: FaceTemplate[];
  consent: Consent;
  createdAt: string;
  lastSeenAt?: string;
  /**
   * The person this agent belongs to.
   *
   * From the requirements: the main user is identified at setup and "has more
   * rights and control over the agent than other people".
   */
  primary?: boolean;
  /** Anything the agent was told about them that is not in its memory graph. */
  notes?: string;
}

/** What a match attempt concluded. */
export type Recognition =
  /** One person, clearly. */
  | { outcome: 'known'; person: Person; score: number }
  /**
   * Somebody, but not confidently enough to use a name.
   *
   * Deliberately distinct from `unknown`: the right response is to ask rather
   * than to greet a stranger by somebody else's name.
   */
  | { outcome: 'unsure'; candidates: Array<{ person: Person; score: number }> }
  /** Nobody on file looks like this. */
  | { outcome: 'unknown' }
  /** Nothing to compare against in this model's space. */
  | { outcome: 'no-templates' };
