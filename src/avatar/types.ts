// Avatar type definitions used by the lipsync and render subsystems.

/** Phoneme viseme group identifiers — map CMU phonemes to mouth shapes */
export type VisemeId = 'rest' | 'AI' | 'E' | 'O' | 'U' | 'MBP' | 'FV' | 'LDN' | 'WQ' | 'SZ';

export interface EyeBounds {
  left:  { x: number; y: number; width: number; height: number };
  right: { x: number; y: number; width: number; height: number };
}

/** A single viseme frame image for sprite-based rendering */
export interface VisemeFrame {
  visemeId: VisemeId;
  imagePath: string;
}

/** AvatarConfig identifies an avatar archetype (used by AvatarGenerator) */
export interface AvatarConfig {
  name: string;
  baseImagePath: string;
  visemeFrames: Partial<Record<VisemeId, string>>;
  eyeBounds?: EyeBounds;
}

/** Runtime asset bundle passed to CanvasRenderer.loadAssets() */
export interface AvatarAssets {
  baseImagePath: string;
  visemeFrames: Partial<Record<VisemeId, string>>;
  eyeBounds?: EyeBounds;
}
