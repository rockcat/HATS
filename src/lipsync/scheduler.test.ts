import { describe, it, expect } from 'vitest';
import { buildVisemeTimeline, getVisemeAt } from './scheduler.js';

describe('buildVisemeTimeline', () => {
  it('returns events for a simple sentence', async () => {
    const timeline = await buildVisemeTimeline('hello world');
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0]).toHaveProperty('visemeId');
    expect(timeline[0]).toHaveProperty('startMs');
    expect(timeline[0]).toHaveProperty('durationMs');
  });

  it('first event starts at 0ms', async () => {
    const timeline = await buildVisemeTimeline('hello');
    expect(timeline[0]!.startMs).toBe(0);
  });

  it('scales timeline to totalDurationMs when provided', async () => {
    const targetDuration = 3000;
    const timeline = await buildVisemeTimeline('hello world', targetDuration);
    const lastEvent = timeline[timeline.length - 1]!;
    const end = lastEvent.startMs + lastEvent.durationMs;
    expect(end).toBeCloseTo(targetDuration, -2); // within ~100ms
  });

  it('events are in ascending time order', async () => {
    const timeline = await buildVisemeTimeline('the quick brown fox');
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.startMs).toBeGreaterThanOrEqual(timeline[i - 1]!.startMs);
    }
  });
});

describe('getVisemeAt', () => {
  it('returns rest before timeline starts', async () => {
    const timeline = await buildVisemeTimeline('hello');
    // getVisemeAt with elapsed=0 should return the first viseme
    const result = getVisemeAt(timeline, 0);
    expect(result).toBeDefined();
  });

  it('returns rest for empty timeline', () => {
    expect(getVisemeAt([], 500)).toBe('rest');
  });
});
