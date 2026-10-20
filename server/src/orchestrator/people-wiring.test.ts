// ── That the face tools actually reach an agent ───────────────────────────────
//
// The tools themselves were written, tested and then wired to nothing: no
// agent was offered them and no call would have run one. Everything below is
// about the seam rather than the recognition, because the seam is the part
// that was missing and the part a refactor would quietly break again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { TeamOrchestrator } from './orchestrator.js';
import { PEOPLE_TOOL_NAMES } from '../people/tools.js';
import { DEFAULT_EMBEDDING_MODEL } from '../device/capabilities.js';

let dir: string;
let orch: TeamOrchestrator;

/** A unit vector of the right length, standing in for a face. */
const face = (seed: number) => {
  const v = new Array(DEFAULT_EMBEDDING_MODEL.dimensions).fill(0);
  v[seed % v.length] = 1;
  return v;
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hats-people-wiring-'));
  orch = new TeamOrchestrator({
    storePath: path.join(dir, 'events.jsonl'),
    projectsRoot: path.join(dir, 'projects'),
  });
  await orch.init();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('offering the tools at all', () => {
  it('claims every tool the people module offers', () => {
    // If these two lists drift, a tool is offered to the model and then
    // reported back as unknown when it calls it.
    orch.setProjectDir(dir);
    for (const name of PEOPLE_TOOL_NAMES) {
      expect(orch.isPeopleTool(name), name).toBe(true);
    }
  });

  it('claims nothing else', () => {
    orch.setProjectDir(dir);
    for (const name of ['read_file', 'send_email', 'device__take_photo']) {
      expect(orch.isPeopleTool(name), name).toBe(false);
    }
  });

  it('offers them without any face model configured', () => {
    // The runner names the embedding space; a phone that can embed does the
    // work. Requiring an environment variable before the tools exist is what
    // made this look unimplemented.
    delete process.env['FACE_MODEL_NAME'];
    delete process.env['FACE_MODEL_DIMENSIONS'];
    orch.setProjectDir(dir);
    expect(orch.isPeopleTool('identify_person')).toBe(true);
  });

  it('claims nothing when there is no project to keep people in', () => {
    // Swallowing the call here would leave the agent waiting on a tool that
    // has nowhere to write; better that it falls through as unknown.
    orch.setProjectDir(null);
    expect(orch.isPeopleTool('identify_person')).toBe(false);
  });
});

describe('running one', () => {
  beforeEach(() => orch.setProjectDir(dir));

  it('remembers somebody and recognises them again', async () => {
    const said = await orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: true, vector: face(1), primary: true,
    });
    expect(said).toContain('Paul');

    const seen = await orch.callPeopleTool('Poppy', 'identify_person', { vector: face(1) });
    expect(seen).toContain('Paul');
  });

  it('refuses to remember a face without consent', async () => {
    await expect(orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: false, vector: face(1),
    })).rejects.toThrow();

    expect(await orch.callPeopleTool('Poppy', 'list_people'))
      .toContain('not been introduced');
  });

  it('does not claim to know a stranger', async () => {
    await orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: true, vector: face(1),
    });
    const seen = await orch.callPeopleTool('Poppy', 'identify_person', { vector: face(50) });
    expect(seen).not.toContain('Paul');
    expect(seen).toMatch(/do not recognise|not sure/i);
  });

  it('forgets on request', async () => {
    await orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: true, vector: face(1),
    });
    expect(await orch.callPeopleTool('Poppy', 'forget_person', { name: 'Paul' }))
      .toContain('Forgotten');
    expect(await orch.callPeopleTool('Poppy', 'identify_person', { vector: face(1) }))
      .not.toContain('Paul');
  });
});

describe('whose people they are', () => {
  it('keeps them in the project, not in the runner', async () => {
    // Two agents on one team share a register: "who is this" is a fact about
    // the world, not about one agent's relationship with somebody.
    orch.setProjectDir(dir);
    await orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: true, vector: face(1),
    });
    expect(await orch.callPeopleTool('Rhoda', 'identify_person', { vector: face(1) }))
      .toContain('Paul');
  });

  it('does not carry one project\'s faces into the next', async () => {
    orch.setProjectDir(dir);
    await orch.callPeopleTool('Poppy', 'remember_person', {
      name: 'Paul', consent: true, vector: face(1),
    });

    const elsewhere = await mkdtemp(path.join(tmpdir(), 'hats-other-project-'));
    try {
      orch.setProjectDir(elsewhere);
      expect(await orch.callPeopleTool('Poppy', 'list_people'))
        .toContain('not been introduced');
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
