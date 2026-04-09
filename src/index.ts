export { HatType } from './hats/types.js';
export type { HatDefinition } from './hats/types.js';
export { hatDefinitions, getHatDefinition } from './hats/definitions.js';

export type { PromptContext, SystemPrompt } from './prompt/types.js';
export { generateSystemPrompt } from './prompt/generator.js';

export type { CompletionRequest, CompletionResponse, AIProvider } from './providers/types.js';
export { ProviderError } from './providers/types.js';
export { MockProvider } from './providers/mock.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { GeminiProvider } from './providers/gemini.js';

export { AgentState } from './agent/types.js';
export type { AgentConfig, AgentMessage, AgentEvent } from './agent/types.js';
export { transition } from './agent/state-machine.js';
export { Agent } from './agent/agent.js';

export { AgentRegistry } from './registry/agent-registry.js';

// Avatar
export type { AvatarConfig, VisemeFrame, AvatarAssets, VisemeId } from './avatar/types.js';
export { VISEME_IDS, PHONEME_TO_VISEME, VISEME_DESCRIPTIONS } from './avatar/visemes.js';
export { AvatarGenerator } from './avatar/generator.js';

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
export { GlbRenderer, createGlbRenderer } from './render/glb-renderer.js';
export type { GlbAvatarConfig } from './render/glb-renderer.js';
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
