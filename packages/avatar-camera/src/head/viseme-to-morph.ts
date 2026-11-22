import { VisemeId } from '../avatar/types.js';
import { MorphWeights } from './types.js';

/**
 * Maps our VisemeId to ARKit blend shape weights.
 * Target: facecap.glb (Three.js example model) which uses ARKit naming.
 */
export const VISEME_MORPH_WEIGHTS: Record<VisemeId, MorphWeights> = {
  rest: {},

  AI: {
    jawOpen: 0.65,
    mouthLowerDownLeft: 0.3,
    mouthLowerDownRight: 0.3,
    mouthShrugLower: 0.15,
  },

  E: {
    jawOpen: 0.35,
    mouthSmileLeft: 0.3,
    mouthSmileRight: 0.3,
    mouthStretchLeft: 0.1,
    mouthStretchRight: 0.1,
  },

  O: {
    jawOpen: 0.45,
    mouthFunnel: 0.65,
    mouthRollLower: 0.2,
    mouthShrugLower: 0.1,
  },

  U: {
    jawOpen: 0.2,
    mouthFunnel: 0.5,
    mouthPucker: 0.75,
    mouthRollLower: 0.15,
  },

  MBP: {
    mouthClose: 0.75,
    mouthPressLeft: 0.35,
    mouthPressRight: 0.35,
    mouthRollLower: 0.2,
    mouthRollUpper: 0.15,
  },

  FV: {
    jawOpen: 0.15,
    mouthLowerDownLeft: 0.45,
    mouthLowerDownRight: 0.45,
    mouthUpperUpLeft: 0.15,
    mouthUpperUpRight: 0.15,
  },

  LDN: {
    jawOpen: 0.28,
    mouthLowerDownLeft: 0.2,
    mouthLowerDownRight: 0.2,
    mouthShrugLower: 0.1,
  },

  WQ: {
    jawOpen: 0.25,
    mouthFunnel: 0.4,
    mouthPucker: 0.35,
    mouthDimpleLeft: 0.1,
    mouthDimpleRight: 0.1,
  },

  SZ: {
    jawOpen: 0.12,
    mouthSmileLeft: 0.12,
    mouthSmileRight: 0.12,
    mouthStretchLeft: 0.05,
    mouthStretchRight: 0.05,
  },
};

export const BLINK_MORPH: MorphWeights = {
  eyeBlinkLeft: 1,
  eyeBlinkRight: 1,
};
