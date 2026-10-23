// ── The models an agent can be pointed at ────────────────────────────────────
//
// A list, not an implementation. The agent library offers these for selection
// and never calls one, so it has no business importing the runner's provider
// classes — which would drag in every SDK the runner speaks to.

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
