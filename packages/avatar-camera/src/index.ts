// ── Avatar camera ───────────────────────────────────────────────────────────
//
// Puts an agent on camera: renders its avatar with no screen, lip-syncs it to
// its speech, and sends the frames to the OBS Virtual Camera, an SRT stream or
// a preview window. A video call can then take the agent as a webcam.
//
// Kept out of the runner, which never loads it: headless OpenGL, canvas, SDL and
// ffmpeg are most of what made the runner's image large. The runner keeps
// three and three-vrm only to send them to the dashboard's browser.

// Avatar
export type { AvatarConfig, VisemeFrame, AvatarAssets, VisemeId } from './avatar/types.js';
export { VISEME_IDS, PHONEME_TO_VISEME, VISEME_DESCRIPTIONS } from './avatar/visemes.js';

// TTS
export type { TTSRequest, TTSResult, TTSProvider } from './tts/types.js';
export { OpenAITTSProvider } from './tts/openai-tts.js';

// Lipsync
export type { PhonemeEntry } from './lipsync/phonemes.js';
export { textToPhonemes } from './lipsync/phonemes.js';
export type { VisemeEvent } from './lipsync/scheduler.js';
export { buildVisemeTimeline, getVisemeAt } from './lipsync/scheduler.js';
export { LipsyncSession } from './lipsync/index.js';
export type { LipsyncSessionConfig } from './lipsync/index.js';

// Render
export type { RendererConfig, FrameCallback } from './render/canvas-renderer.js';
export { CanvasRenderer } from './render/canvas-renderer.js';
export { GlbRenderer, createGlbRenderer, createAvatarRenderer } from './render/glb-renderer.js';
export type { GlbAvatarConfig } from './render/glb-renderer.js';
export { VrmRenderer } from './render/vrm-renderer.js';
export { FrameClock } from './render/frame-clock.js';

// Webcam
export type { OBSOutputConfig } from './webcam/obs-output.js';
export { OBSOutput } from './webcam/obs-output.js';

// Viewer
export type { SDLViewerConfig } from './viewer/sdl-viewer.js';
export { SDLViewer } from './viewer/sdl-viewer.js';

// Head (3D)
export type { HeadConfig, MorphWeights, HeadModel } from './head/types.js';
export { VISEME_MORPH_WEIGHTS, BLINK_MORPH } from './head/viseme-to-morph.js';
export { generateHeadTexture } from './head/texture-generator.js';

// 3D Renderer
export { HeadlessRenderer } from './renderer3d/headless-renderer.js';
export { HeadScene } from './renderer3d/head-scene.js';

// Media Server
export type { MediaOutput } from './media/types.js';
export { SRTOutput } from './media/srt-output.js';
export { MediaServer } from './media/media-server.js';
