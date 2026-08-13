// ── Application state ─────────────────────────────────────────────────────────
// `state` is mutated in place (Object.assign) so all importers see updates.

import { getAvatarOverrides, setAvatarOverride } from './avatars.js';
import { getVoiceOverrides, setVoiceOverride, setSpeakerOverride } from './voice.js';

export const state = { agents: [], tickets: [], humanName: 'human' };

// Tracks hat, voice, avatar per agent so dropdowns can show usage by others.
export const agentConfigs = new Map(); // name → { hatType, voice, avatar, background }

export function syncAgentConfigs() {
  const voiceOverrides  = getVoiceOverrides();
  const avatarOverrides = getAvatarOverrides();
  for (const agent of state.agents) {
    const avatar     = agent.avatar      ?? avatarOverrides[agent.name] ?? null;
    const voice      = agent.voice       ?? voiceOverrides[agent.name]  ?? null;
    const background = agent.background  ?? null;
    agentConfigs.set(agent.name, { hatType: agent.hatType, voice, avatar, background });
    if (agent.avatar)      setAvatarOverride(agent.name, agent.avatar);
    if (agent.voice)       setVoiceOverride(agent.name, agent.voice);
    if (agent.speakerName) setSpeakerOverride(agent.name, agent.speakerName);
  }
  for (const name of agentConfigs.keys()) {
    if (!state.agents.find(a => a.name === name)) agentConfigs.delete(name);
  }
}

/** Count how many agents OTHER than `excludeName` have field === value. */
export function usageCount(field, value, excludeName) {
  if (!value) return 0;
  let n = 0;
  for (const [name, cfg] of agentConfigs) {
    if (name !== excludeName && cfg[field] === value) n++;
  }
  return n;
}

/** Return names of agents OTHER than `excludeName` that have field === value. */
export function usersOf(field, value, excludeName) {
  if (!value) return [];
  const names = [];
  for (const [name, cfg] of agentConfigs) {
    if (name !== excludeName && cfg[field] === value) names.push(name);
  }
  return names;
}
