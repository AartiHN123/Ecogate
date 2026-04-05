'use strict';

/**
 * EcoGate Provider Registry
 *
 * All listed providers expose an OpenAI-compatible chat completions API,
 * so we can reuse the same OpenAI SDK — just swap baseURL + apiKey.
 *
 * To add a new provider:
 *  1. Add an entry here.
 *  2. Add its API key to .env (matching the envKey field).
 *  3. Done.
 */
const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    website: 'https://platform.openai.com',
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    // Anthropic's OpenAI-compatible endpoint requires the /v1 path AND the
    // anthropic-beta header to enable the compatibility layer.
    baseURL: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-haiku-20240307',
    models: ['claude-3-haiku-20240307', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    website: 'https://console.anthropic.com',
    // Required headers for Anthropic's OpenAI-compat layer
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'messages-2023-12-15',
    },
  },

  google: {
    id: 'google',
    name: 'Google Gemini',
    // Google's official OpenAI-compatible endpoint
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    envKey: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-1.5-flash',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.0-pro'],
    website: 'https://aistudio.google.com',
  },

  zai: {
    id: 'zai',
    name: 'Z.AI (GLM)',
    // Zhipu AI — OpenAI-compatible endpoint
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    envKey: 'ZAI_API_KEY',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4', 'glm-4-plus'],
    website: 'https://open.bigmodel.cn',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.1-8b-instant',
    models: ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    website: 'https://console.groq.com',
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'open-mistral-7b'],
    website: 'https://console.mistral.ai',
  },

  together: {
    id: 'together',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
    models: ['meta-llama/Llama-3-8b-chat-hf', 'meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.3'],
    website: 'https://api.together.ai',
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    baseURL: 'http://localhost:11434/v1',
    envKey: 'OLLAMA_BASE_URL', // not a key — used as a presence sentinel; always "enabled"
    defaultModel: 'qwen2.5:1.5b',
    models: ['qwen2.5:1.5b', 'llama3.2', 'gemma4:e4b', 'mistral'],
    website: 'https://ollama.com',
  },
};

/**
 * Resolve a provider by ID.
 * Returns the provider config or throws if unknown.
 */
function getProvider(id = 'openai') {
  const provider = PROVIDERS[id.toLowerCase()];
  if (!provider) {
    const available = Object.keys(PROVIDERS).join(', ');
    const err = new Error(`Unknown provider "${id}". Available: ${available}`);
    err.status = 400;
    throw err;
  }
  return provider;
}

/**
 * Get the API key for a provider from environment variables.
 * Returns null if the key isn't set (let caller decide how to handle).
 */
function getApiKey(provider) {
  return process.env[provider.envKey] || null;
}

/**
 * Return a sanitised list of providers safe to expose via REST API.
 * Omits internal fields, adds an `enabled` flag based on key presence.
 */
function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    defaultModel: p.defaultModel,
    models: p.models,
    website: p.website,
    // Ollama is always enabled (local); cloud providers need an API key
    enabled: p.id === 'ollama' ? true : !!process.env[p.envKey],
  }));
}

module.exports = { PROVIDERS, getProvider, getApiKey, listProviders };
