export interface AvatarConfig {
  description: string;       // e.g. "middle aged indian man in red shirt"
  name: string;              // agent name, used in file naming
  outputDir: string;         // where to save generated images
  imageSize?: 512 | 1024;   // display size; default 512
}

export type VisemeId =
  | 'rest'   // silence / neutral
  | 'AI'     // A, I sounds
  | 'E'      // E sound
  | 'O'      // O sound
  | 'U'      // U sound
  | 'MBP'    // M, B, P — lips closed
  | 'FV'     // F, V — teeth on lower lip
  | 'LDN'    // L, D, N, TH — tongue behind teeth
  | 'WQ'     // W, Q — rounded lips
  | 'SZ';    // S, Z — teeth together

export interface VisemeFrame {
  visemeId: VisemeId;
  imagePath: string;         // absolute path to PNG
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EyeBounds {
  left:  Rect;
  right: Rect;
}

export interface AvatarAssets {
  name: string;
  description: string;
  characterDescription: string;  // GPT-4o derived detailed description used for all frames
  baseImagePath: string;
  visemeFrames: Record<VisemeId, string>;  // visemeId → imagePath
  eyeBounds: EyeBounds;           // used by BlinkController at runtime
  mouthBounds: Rect;              // mouth region at displaySize px (for reference)
}
