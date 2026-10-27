/**
 * Where an agent's face comes from.
 *
 * For a deployed agent, everything comes from the Embodiment API — the model,
 * the background, and the `appearance` framing on the roster entry. That is the
 * point of the stage: it proves an outside client can render an agent from the
 * API alone, with no access to the runner's files and no idea what
 * `avatars.json` is.
 *
 * A library-only agent has no instance to ask, so its model and framing come
 * from the Agent Template Library instead. Keeping the decision in one pure function
 * means it is always obvious which of the two is being exercised.
 *
 * No imports and no DOM, so this is directly testable.
 */

/**
 * @param {object|null} row       a roster row from `roster-model.js`
 * @param {Array} catalogue       the library's avatar catalogue
 * @param {{avatarUrl(id): string, backgroundUrl(id): string}} runner
 * @returns {{label: string, avatarUrl: string|null, backgroundUrl: string|null, framing: object}}
 */
export function sourcesFor(row, catalogue, runner) {
  const { avatar, background } = row?.identity ?? {};
  const entry = catalogue.find((a) => a.file === avatar);

  if (row?.live) {
    return {
      label: 'Embodiment API',
      avatarUrl: avatar ? runner.avatarUrl(row.live.id) : null,
      backgroundUrl: background ? runner.backgroundUrl(row.live.id) : null,
      // The runner ships its own framing. The catalogue is the fallback for a
      // model the runner could not find in its own catalogue, and for a runner
      // too old to send any.
      framing: row.live.appearance ?? framingOf(entry),
    };
  }

  return {
    label: 'Agent Template Library',
    avatarUrl: avatar ? `/library/avatars/${encodeURIComponent(avatar)}` : null,
    backgroundUrl: background ? `/library/backgrounds/${encodeURIComponent(background)}` : null,
    framing: framingOf(entry),
  };
}

/** Just the placement fields — the rest of a catalogue entry means nothing here. */
function framingOf(entry) {
  if (!entry) return {};
  const { camera, rotate, fov, scale } = entry;
  return {
    ...(camera && { camera }),
    ...(rotate && { rotate }),
    ...(fov !== undefined && { fov }),
    ...(scale !== undefined && { scale }),
  };
}
