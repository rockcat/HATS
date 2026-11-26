// ── Knowing who you are talking to ────────────────────────────────────────────
//
// The tools an agent uses to recognise somebody, ask their name, and forget
// them again. Shaped around the conversation in the requirements: look, and if
// you do not know them, ask — rather than a lookup that returns a row.
//
// Two things the descriptions have to carry, because the model reads nothing
// else before deciding what to do:
//
//  * `unsure` is not `unknown`. One means ask which of two people this is, the
//    other means ask whether to remember a stranger. Collapsing them produces
//    an agent that confidently calls people by the wrong name.
//  * Remembering a face needs the person's agreement, out loud, first. That is
//    not a formality to narrate after the fact — without it `remember_person`
//    refuses.

import { ConsentRequired, PeopleStore, withoutTemplates } from './store.js';
import type { Recognition } from './types.js';
import type { FaceEmbedder } from './embedder.js';
import { whyNotAvailable, type EmbedderConfig } from './embedder.js';
import type { EmbeddingModel } from '../device/capabilities.js';
import { PEOPLE_TOOL_NAMES, peopleToolDefinitions, type PeopleTool } from '../../../packages/core/src/tools/people.js';

export interface PeopleToolsContext {
  store: PeopleStore;
  /** The canonical model every stored template is in. Always named. */
  model: EmbeddingModel;
  /** The runner's own embedder, when it has one. */
  embedder?: FaceEmbedder | null;
  config: EmbedderConfig;
  /** Which agent is asking, recorded against any consent it collects. */
  agentName: string;
  /**
   * Ask the device in front of the user to look and send back a vector.
   *
   * This is the path that matters. A phone or a browser tab runs the model
   * itself, so the face never leaves the device and the agent never handles
   * 192 floats it cannot use. Absent when nothing is connected that can.
   */
  askDevice?: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}

export { PEOPLE_TOOL_NAMES, type PeopleTool };

/** Tool definitions, shaped by what this runner can actually do. */
export function peopleTools(_context: PeopleToolsContext): PeopleTool[] {
  return peopleToolDefinitions();
}

/** Turn a recognition into something the agent can act on. */
export function describeRecognition(result: Recognition): string {
  switch (result.outcome) {
    case 'known':
      return `This is ${result.person.name} (confidence ${result.score.toFixed(2)}).`
        + (result.person.primary ? ' They are your main user.' : '')
        + (result.person.notes ? `\nYou noted: ${result.person.notes}` : '');
    case 'unsure':
      return 'Not sure who this is — it could be '
        + result.candidates.map((c) => `${c.person.name} (${c.score.toFixed(2)})`).join(' or ')
        + '. Ask them rather than guessing.';
    case 'unknown':
      return 'You do not recognise this person. If it seems right to, ask their name '
        + 'and whether they are happy for you to remember them.';
    case 'no-templates':
      return 'You have not been introduced to anybody yet, so there is nobody to '
        + 'compare against. Ask who they are.';
  }
}

/** Get a vector from whichever of the two forms the caller supplied. */
async function vectorFrom(
  context: PeopleToolsContext, args: Record<string, unknown>,
): Promise<number[]> {
  const given = args['vector'] ?? await fromDevice(context);
  if (Array.isArray(given) && given.length > 0) {
    const vector = given.map(Number);
    if (vector.some((v) => !Number.isFinite(v))) {
      throw new Error('That face vector contains values I cannot read.');
    }
    const expected = context.model.dimensions;
    if (vector.length !== expected) {
      // Silently storing it would put a template in the file that can never
      // match anything, and nobody would be able to tell why.
      throw new Error(
        `That vector has ${vector.length} dimensions and this runner's people are `
        + `stored with ${expected} (${context.model.model}). They cannot be compared.`,
      );
    }
    return vector;
  }

  const image = args['image_base64'];
  if (typeof image === 'string' && image.length > 0) {
    if (!context.embedder) throw new Error(whyNotAvailable(context.config, context.model));
    const vector = await context.embedder.embed(Buffer.from(image, 'base64'));
    if (!vector) throw new Error('There is no face in that picture.');
    return vector;
  }

  throw new Error(
    'There is nothing here that can see a face: no device is connected that can '
    + 'embed one, and no picture was given. Ask the user to open their companion '
    + 'app or point their camera at themselves.',
  );
}

/**
 * Ask whatever is embodying the agent to look.
 *
 * Returns undefined rather than throwing on every kind of failure, so the
 * caller falls through to a photo or to a clear refusal. A device that cannot
 * see a face is not an error worth a stack trace — it is "I cannot see you",
 * which the sentence below says better.
 */
async function fromDevice(context: PeopleToolsContext): Promise<number[] | undefined> {
  if (!context.askDevice) return undefined;
  const answer = await context.askDevice();
  if (!answer.ok) throw new Error(answer.error);
  const vector = answer.data;
  if (!Array.isArray(vector) || vector.length === 0) return undefined;
  return vector.map(Number);
}

/** Run one of the tools. Separated from the transport so it can be tested. */
export async function handlePeopleCall(
  context: PeopleToolsContext, name: string, args: Record<string, unknown>,
): Promise<string> {
  const { store, model } = context;

  switch (name) {
    case 'identify_person': {
      const vector = await vectorFrom(context, args);
      return describeRecognition(await store.identify(vector, model.model));
    }

    case 'remember_person': {
      const personName = String(args['name'] ?? '').trim();
      if (!personName) throw new Error('What is their name?');
      if (args['consent'] !== true) {
        throw new ConsentRequired(personName);
      }

      const vector = await vectorFrom(context, args);
      const person = await store.remember(personName, vector, model.model, {
        granted: true,
        at: new Date().toISOString(),
        askedBy: context.agentName,
      }, {
        ...(args['primary'] === true ? { primary: true } : {}),
        ...(typeof args['notes'] === 'string' ? { notes: args['notes'] } : {}),
      });

      return `You will recognise ${person.name} next time`
        + (person.primary ? ', and they are your main user' : '')
        + `. You have ${person.templates.length} view(s) of their face.`;
    }

    case 'forget_person': {
      const wanted = String(args['name'] ?? '').trim();
      const gone = await store.forget(wanted);
      return gone
        ? `Forgotten ${gone.name} completely — face included. You will not recognise them again.`
        : `You do not have anybody called "${wanted}".`;
    }

    case 'list_people': {
      const people = await store.all();
      if (people.length === 0) return 'You have not been introduced to anybody yet.';
      return people.map((p) => {
        const shown = withoutTemplates(p);
        return `${shown.name}${shown.primary ? ' (your main user)' : ''}`
          + ` — ${shown.faces} view(s) of their face`
          + (shown.lastSeenAt ? `, last seen ${shown.lastSeenAt}` : '')
          + (shown.notes ? `\n  ${shown.notes}` : '');
      }).join('\n');
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
