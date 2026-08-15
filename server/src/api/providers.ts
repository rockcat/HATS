import { AIProvider } from '../providers/types.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAIProvider, OllamaProvider, LMStudioProvider } from '../providers/openai.js';
import { GeminiProvider } from '../providers/gemini.js';
import { log } from '../util/logger.js';

export function makeProvider(id: string): AIProvider | null {
  switch (id) {
    case 'anthropic': return new AnthropicProvider();
    case 'openai':    return new OpenAIProvider();
    case 'gemini':    return new GeminiProvider();
    case 'ollama':    return new OllamaProvider();
    case 'lmstudio':  return new LMStudioProvider();
    default:          return null;
  }
}

export const KNOWN_PROVIDERS = [
  {
    id: 'anthropic', label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY', modelEnvKey: 'ANTHROPIC_MODEL',
    models: [
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-haiku-20240307"
    ],
  },
  {
    id: 'openai', label: 'OpenAI',
    envKey: 'OPENAI_API_KEY', modelEnvKey: 'OPENAI_MODEL',
    models: [
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "o3",
      "o3-mini",
      "o1",
      "o1-mini",
      "gpt-4o",
      "gpt-4o-mini",
    ],
  },
  {
    id: 'gemini', label: 'Google Gemini',
    envKey: 'GEMINI_API_KEY', modelEnvKey: 'GEMINI_MODEL',
    models: [
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro"
    ],
  },
  {
    id: 'ollama', label: 'Ollama (local)',
    envKey: '', modelEnvKey: 'OLLAMA_MODEL',
    baseUrlEnvKey: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['llama3.3', 'llama3.2', 'llama3.1', 'mistral', 'mixtral', 'phi4', 'phi3', 'gemma3', 'qwen2.5', 'deepseek-r1'],
  },
  {
    id: 'lmstudio', label: 'LM Studio (local)',
    envKey: '', modelEnvKey: 'LM_STUDIO_MODEL',
    baseUrlEnvKey: 'LM_STUDIO_BASE_URL',
    defaultBaseUrl: 'http://localhost:1234/v1',
    models: [],
  },
] as const;

export type KnownProvider = typeof KNOWN_PROVIDERS[number];

export async function probeLocalLLM(baseUrl: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const openAIUrl = baseUrl.replace(/\/+$/, '') + '/models';
    const res = await fetch(openAIUrl, { signal: abort.signal });
    clearTimeout(timer);
    if (res.ok) {
      log.info(`[Probe] ${baseUrl} → OK via /models`);
      return true;
    }
    const rootUrl = baseUrl.replace(/\/v1\/?$/, '');
    if (rootUrl === baseUrl.replace(/\/+$/, '')) {
      log.info(`[Probe] ${baseUrl} → offline (HTTP ${res.status})`);
      return false;
    }
    const res2 = await fetch(rootUrl, { signal: abort.signal });
    log.info(`[Probe] ${baseUrl} → ${res2.ok ? 'OK via root' : `offline (HTTP ${res2.status})`}`);
    return res2.ok;
  } catch (err) {
    clearTimeout(timer);
    log.info(`[Probe] ${baseUrl} → offline (${(err as Error).message})`);
    return false;
  }
}

const TTL_DEFAULT = 24 * 60 * 60 * 1000;
const TTL_LOCAL   =  5 * 60 * 1000;

const modelCache = new Map<string, { models: string[]; ts: number }>();

function modelCacheTtl(providerId: string): number {
  return (providerId === 'ollama' || providerId === 'lmstudio') ? TTL_LOCAL : TTL_DEFAULT;
}

export async function fetchLiveModels(p: KnownProvider): Promise<string[]> {
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    let models: string[] = [];

    if (p.id === 'anthropic') {
      const key = process.env['ANTHROPIC_API_KEY'];
      if (!key) { log.info('[Models] anthropic: no API key, skipping'); return []; }
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] anthropic: HTTP ${r.status}`); return []; }
      const data = await r.json() as { data: Array<{ id: string }> };
      models = data.data.map(m => m.id).sort();
      log.info(`[Models] anthropic: ${models.length} model(s)`);

    } else if (p.id === 'openai') {
      const key = process.env['OPENAI_API_KEY'];
      if (!key) { log.info('[Models] openai: no API key, skipping'); return []; }
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: abort.signal,
      });
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] openai: HTTP ${r.status}`); return []; }
      const data = await r.json() as { data: Array<{ id: string }> };
      models = data.data
        .map(m => m.id)
        .filter(id => /^(gpt-|o1|o3|o4)/.test(id))
        .sort();
      log.info(`[Models] openai: ${models.length} model(s)`);

    } else if (p.id === 'gemini') {
      const key = process.env['GEMINI_API_KEY'];
      if (!key) { log.info('[Models] gemini: no API key, skipping'); return []; }
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
        { signal: abort.signal },
      );
      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] gemini: HTTP ${r.status}`); return []; }
      const data = await r.json() as { models: Array<{ name: string; supportedGenerationMethods?: string[] }> };
      models = data.models
        .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .sort();
      log.info(`[Models] gemini: ${models.length} model(s)`);

    } else if (p.id === 'ollama' || p.id === 'lmstudio') {
      const pid = p.id;
      const baseUrl = (p.baseUrlEnvKey ? process.env[p.baseUrlEnvKey] : undefined) || p.defaultBaseUrl || '';
      if (!baseUrl) { log.warn(`[Models] ${pid}: no base URL configured`); return []; }

      const openAIUrl = baseUrl.replace(/\/+$/, '') + '/models';
      log.info(`[Models] ${p.id}: trying ${openAIUrl}`);
      let r = await fetch(openAIUrl, { signal: abort.signal });

      if (!r.ok && p.id === 'ollama') {
        const nativeUrl = baseUrl.replace(/\/v1\/?$/, '') + '/api/tags';
        log.info(`[Models] ollama: /v1/models returned ${r.status}, trying native ${nativeUrl}`);
        r = await fetch(nativeUrl, { signal: abort.signal });
      }

      clearTimeout(timer);
      if (!r.ok) { log.warn(`[Models] ${p.id}: HTTP ${r.status} from ${r.url}`); return []; }

      const data = await r.json() as { data?: Array<{ id: string }>; models?: Array<{ name: string }> };
      if (data.data)        models = data.data.map(m => m.id).sort();
      else if (data.models) models = data.models.map(m => m.name).sort();
      log.info(`[Models] ${p.id}: ${models.length} model(s) — ${models.slice(0, 5).join(', ')}${models.length > 5 ? '…' : ''}`);
    }

    return models;
  } catch (err) {
    log.warn(`[Models] ${p.id}: fetch failed — ${(err as Error).message}`);
    return [];
  }
}

export async function getCachedModels(p: KnownProvider): Promise<string[]> {
  const cached = modelCache.get(p.id);
  if (cached && (Date.now() - cached.ts) < modelCacheTtl(p.id)) {
    log.info(`[Models] ${p.id}: serving ${cached.models.length} model(s) from cache`);
    return cached.models;
  }
  const live = await fetchLiveModels(p);
  if (live.length > 0) {
    modelCache.set(p.id, { models: live, ts: Date.now() });
    return live;
  }
  if (p.models.length > 0) log.info(`[Models] ${p.id}: live fetch empty, using ${p.models.length} static fallback(s)`);
  return [...p.models];
}

export function getModelCacheEntry(providerId: string): { models: string[]; ts: number } | undefined {
  return modelCache.get(providerId);
}

export function clearModelCache(providerId: string): void {
  modelCache.delete(providerId);
}
