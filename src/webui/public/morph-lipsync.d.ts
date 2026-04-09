// Type declarations for morph-lipsync.js (shared browser/server ES module)

export declare const BLEND: number;
export declare const BODY_KEYWORDS: string[];

/**
 * Traverse a Three.js scene and return all meshes that have viseme_* morph targets.
 * Also hides body meshes (non-face geometry).
 */
export declare function collectVisemeMeshes(scene: object): object[];

/**
 * Advance morph weight map one frame: decay all weights toward 0,
 * then blend targetViseme weight toward 1.
 * Mutates and returns the weights object.
 */
export declare function stepMorphWeights(
  weights: Record<string, number>,
  targetViseme: string,
): Record<string, number>;

/**
 * Write the morph weight map to morphTargetInfluences on each mesh.
 * Only keys that start with 'viseme_' are written.
 */
export declare function applyMorphWeights(meshes: object[], weights: Record<string, number>): void;
