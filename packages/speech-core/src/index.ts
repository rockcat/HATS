/**
 * @hats/speech-core — the shared vocabulary of HATS speech.
 *
 * Types that cross the Speech Service boundary, the Rhubarb-to-ARKit viseme
 * map, and voice model discovery. Deliberately free of any process spawning:
 * a consumer that only needs to *name* voices can import this without pulling
 * in Piper or Rhubarb.
 */

export * from './types.js';
export * from './voice-models.js';
export * from './rhubarb-map.js';
