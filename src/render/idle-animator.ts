/**
 * IdleAnimator — drives continuous subtle motion on a canvas to keep the avatar
 * feeling alive. All movement is programmatic (zero API calls at runtime).
 *
 * Layers applied each frame (in order):
 *   1. Micro-drift  — slow sine-wave position wander (breathing feel)
 *   2. Micro-scale  — very subtle scale oscillation (breathing)
 *   3. Blink        — periodic eyelid overlay using detected eye bounds
 */

import { EyeBounds } from '../avatar/types.js';

export interface IdleState {
  /** Translation to apply before drawing the face image */
  dx: number;
  dy: number;
  /** Scale factor (very close to 1.0) */
  scale: number;
  /** 0 = eyes open, 1 = eyes fully closed */
  blinkProgress: number;
}

export class IdleAnimator {
  private startTime: number;
  private nextBlinkAt: number;
  private blinkStartedAt: number | null = null;
  private readonly BLINK_DURATION_MS = 150;

  constructor() {
    this.startTime = Date.now();
    this.nextBlinkAt = Date.now() + randomBetween(2000, 5000);
  }

  /** Call once per frame to get the current idle state */
  tick(): IdleState {
    const now = Date.now();
    const t = (now - this.startTime) / 1000; // seconds

    // Micro-drift: two overlapping sine waves per axis for organic feel
    const dx = Math.sin(t * 0.3) * 1.5 + Math.sin(t * 0.7) * 0.8;
    const dy = Math.sin(t * 0.25) * 1.2 + Math.sin(t * 0.6) * 0.6;

    // Micro-scale: very subtle breathing
    const scale = 1 + Math.sin(t * 0.4) * 0.003;

    // Blink logic
    let blinkProgress = 0;
    if (now >= this.nextBlinkAt) {
      if (this.blinkStartedAt === null) this.blinkStartedAt = now;
      const elapsed = now - this.blinkStartedAt;
      if (elapsed < this.BLINK_DURATION_MS) {
        // Triangle wave: close then open
        blinkProgress = elapsed < this.BLINK_DURATION_MS / 2
          ? (elapsed / (this.BLINK_DURATION_MS / 2))
          : (1 - (elapsed - this.BLINK_DURATION_MS / 2) / (this.BLINK_DURATION_MS / 2));
      } else {
        // Blink complete — schedule next
        this.blinkStartedAt = null;
        this.nextBlinkAt = now + randomBetween(2500, 6000);
      }
    }

    return { dx, dy, scale, blinkProgress };
  }

  reset(): void {
    this.startTime = Date.now();
    this.nextBlinkAt = Date.now() + randomBetween(2000, 5000);
    this.blinkStartedAt = null;
  }
}

// EyeBounds is imported so it's available for consumers who import this module alongside it
export type { EyeBounds };

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
