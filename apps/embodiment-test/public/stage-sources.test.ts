import { describe, it, expect } from 'vitest';
// @ts-expect-error — a browser module, deliberately free of imports so it can be tested here.
import { sourcesFor } from './stage-sources.js';

const runner = {
  avatarUrl: (id: string) => `/runner/api/embodiment/v1/agents/${id}/avatar`,
  backgroundUrl: (id: string) => `/runner/api/embodiment/v1/agents/${id}/background`,
};

const catalogue = [
  { name: 'Max', file: 'max.glb', camera: [0, 1.7, 0.55], rotate: [0, 0, 0], fov: 44, scale: 1 },
];

const row = (identity: Record<string, unknown>, live: Record<string, unknown> | null = null) =>
  ({ key: 'poppy', name: 'Poppy', identity, live });

describe('sourcesFor', () => {
  it('serves a deployed agent entirely from the Embodiment API', () => {
    const source = sourcesFor(
      row({ avatar: 'max.glb', background: 'office.png' }, { id: 'inst-1', appearance: { fov: 40 } }),
      catalogue, runner,
    );
    expect(source).toMatchObject({
      label: 'Embodiment API',
      avatarUrl: '/runner/api/embodiment/v1/agents/inst-1/avatar',
      backgroundUrl: '/runner/api/embodiment/v1/agents/inst-1/background',
      framing: { fov: 40 },
    });
  });

  it('falls back to the library catalogue when the runner sends no framing', () => {
    const source = sourcesFor(row({ avatar: 'max.glb' }, { id: 'inst-1' }), catalogue, runner);
    expect(source.framing).toEqual({ camera: [0, 1.7, 0.55], rotate: [0, 0, 0], fov: 44, scale: 1 });
  });

  it('serves a library-only agent from the library, framing included', () => {
    const source = sourcesFor(row({ avatar: 'max.glb', background: 'office.png' }), catalogue, runner);
    expect(source).toMatchObject({
      label: 'Agent Template Library',
      avatarUrl: '/library/avatars/max.glb',
      backgroundUrl: '/library/backgrounds/office.png',
      framing: { camera: [0, 1.7, 0.55], fov: 44 },
    });
  });

  it('escapes a filename with a space rather than producing a broken URL', () => {
    const source = sourcesFor(row({ background: 'my office.png' }), catalogue, runner);
    expect(source.backgroundUrl).toBe('/library/backgrounds/my%20office.png');
  });

  it('reports no URL, rather than a 404, when there is nothing to show', () => {
    expect(sourcesFor(row({}), catalogue, runner)).toMatchObject({ avatarUrl: null, backgroundUrl: null });
    expect(sourcesFor(null, catalogue, runner)).toMatchObject({ avatarUrl: null, backgroundUrl: null });
  });

  it('gives empty framing for an avatar that is in no catalogue', () => {
    // Two templates still point at retired models; they render unframed
    // rather than not at all.
    expect(sourcesFor(row({ avatar: 'dave.glb' }), catalogue, runner).framing).toEqual({});
  });
});
