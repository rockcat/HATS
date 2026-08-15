// ── Avatar & background catalogue ────────────────────────────────────────────

export let avatarList = null;     // cached from /api/avatars
export let backgroundList = null; // cached filenames from /api/images/backgrounds

export async function getAvatars() {
  if (avatarList) return avatarList;
  try {
    const res = await fetch('/api/avatars');
    const data = await res.json();
    avatarList = data.avatars || [];
  } catch {
    avatarList = [];
  }
  return avatarList;
}

export async function getBackgrounds(forceRefresh = false) {
  if (backgroundList && !forceRefresh) return backgroundList;
  try {
    const res = await fetch('/api/images/backgrounds');
    const data = await res.json();
    backgroundList = data.backgrounds || [];
  } catch {
    backgroundList = [];
  }
  return backgroundList;
}

export function applyAvatarBackground(filename) {
  const panel = document.getElementById('avatar-panel');
  if (!panel) return;
  if (filename) {
    panel.style.backgroundImage = `url('/backgrounds/${encodeURIComponent(filename)}')`;
    panel.style.backgroundSize = 'cover';
    panel.style.backgroundPosition = 'center';
  } else {
    panel.style.backgroundImage = '';
  }
}

export function findAvatarForAgent(name) {
  if (!avatarList) return null;
  const overrides = getAvatarOverrides();
  const overrideFile = overrides[name];
  if (overrideFile) {
    const found = avatarList.find(a => a.file === overrideFile);
    if (found) return found;
  }
  return avatarList.find(a => a.name.toLowerCase() === name.toLowerCase()) || null;
}

export function getAvatarOverrides() {
  try { return JSON.parse(localStorage.getItem('agentAvatars') || '{}'); } catch { return {}; }
}

export function setAvatarOverride(agentName, avatarFile) {
  const overrides = getAvatarOverrides();
  if (avatarFile) overrides[agentName] = avatarFile;
  else delete overrides[agentName];
  localStorage.setItem('agentAvatars', JSON.stringify(overrides));
}
