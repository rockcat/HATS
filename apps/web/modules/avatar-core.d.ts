/**
 * Typings for the browser avatar helpers that the headless GLB renderer reuses.
 * Only the exports the server actually imports are declared.
 */
import type { Object3D } from 'three';

/** Drop a GLB humanoid's arms from T-pose to a natural A-pose. */
export function applyGlbRestPose(root: Object3D): void;
