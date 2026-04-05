'use strict';

/**
 * EcoGate Model Router
 *
 * Maps a complexity score (1–5) to the optimal model for a given provider.
 *
 * Tier definitions:
 *   small  — score 1–2   (~90% carbon savings vs. large)
 *   medium — score 3     (~60% carbon savings vs. large)
 *   large  — score 4–5   (baseline, no savings)
 *
 * Override any tier model via env vars:
 *   ROUTER_<PROVIDER_ID>_SMALL   e.g. ROUTER_OPENAI_SMALL=gpt-5.4-nano
 *   ROUTER_<PROVIDER_ID>_MEDIUM  e.g. ROUTER_OPENAI_MEDIUM=gpt-5.4-mini
 *   ROUTER_<PROVIDER_ID>_LARGE   e.g. ROUTER_OPENAI_LARGE=gpt-5.4
 */

// ─── Default model tiers per provider ───────────────────────────────────────
// Keys must match provider IDs in providers.js
const DEFAULT_TIERS = {
  openai: {
    small:  'gpt-5.4-nano',
    medium: 'gpt-5.4-mini',
    large:  'gpt-5.4',
  },
  anthropic: {
    small:  'claude-haiku-4-5-20251001',
    medium: 'claude-sonnet-4-6',
    large:  'claude-opus-4-6',
  },
  google: {
    small:  'gemini-3.1-flash-lite-preview',
    medium: 'gemini-3.1-flash-preview',
    large:  'gemini-3.1-pro-preview',
  },
  zai: {
    small:  'glm-4.5',
    medium: 'glm-4.6V',
    large:  'glm-5',
  },
  groq: {
    small:  'llama-3.1-8b-instant',
    medium: 'openai/gpt-oss-20b',
    large:  'openai/gpt-oss-120b',
  },
  mistral: {
    small:  'ministral-8b-2410',
    medium: 'mistral-medium-3-instruct',
    large:  'mistral-large-3-675b-instruct-2512',
  },
  together: {
    small:  'openai/gpt-oss-20b',
    medium: 'openai/gpt-oss-120b',
    large:  'moonshotai/Kimi-K2.5',
  },

  // Local Ollama — no cloud dependency.
  ollama: {
    small:  'gemma4:e4b',
    medium: 'gemma4:31b',
    large:  'deepseek-r1:671b',
  },
};
/**
 * Determine the complexity tier name from a numeric score.
 *
 * @param {number} score  1–5
 * @returns {'small'|'medium'|'large'}
 */
function scoreTier(score) {
  if (score <= 2) return 'small';
  if (score === 3) return 'medium';
  return 'large';
}

/**
 * Get a tier's model for a provider, respecting env-var overrides.
 *
 * @param {string} providerId  e.g. 'openai'
 * @param {'small'|'medium'|'large'} tier
 * @returns {string} model name
 */
function getTierModel(providerId, tier) {
  const envKey = `ROUTER_${providerId.toUpperCase()}_${tier.toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey];

  const providerTiers = DEFAULT_TIERS[providerId];
  if (!providerTiers) return null; // unknown provider — caller must fallback
  return providerTiers[tier] || null;
}

/**
 * Resolve the target model given a complexity score and provider.
 *
 * If the caller already specified a model explicitly (`requestedModel`),
 * EcoGate will still route — but only when `ECOGATE_RESPECT_MODEL=false`
 * (default). Set `ECOGATE_RESPECT_MODEL=true` to honour the caller's choice
 * and skip routing.
 *
 * @param {number}  score          - Classifier score 1–5
 * @param {string}  providerId     - Provider id (e.g. 'openai')
 * @param {string}  [requestedModel] - Model the caller asked for (may be empty)
 * @param {object}  [providerDefault] - Provider's defaultModel as last resort
 * @returns {{ model: string, tier: string, wasRouted: boolean }}
 */
function routeModel(score, providerId, requestedModel = '', providerDefault = '') {
  // If caller opt-in to skip routing
  const respectCaller = (process.env.ECOGATE_RESPECT_MODEL || 'false').toLowerCase() === 'true';
  if (respectCaller && requestedModel) {
    return { model: requestedModel, tier: 'caller', wasRouted: false };
  }

  const tier  = scoreTier(score);
  const model = getTierModel(providerId, tier)
    || requestedModel
    || providerDefault
    || 'gemma4:e4b'; // ultimate fallback — local Ollama model

  return { model, tier, wasRouted: true };
}

/**
 * Return all tier models for a provider (useful for dashboard/settings).
 *
 * @param {string} providerId
 * @returns {{ small: string, medium: string, large: string }|null}
 */
function getProviderTiers(providerId) {
  const base = DEFAULT_TIERS[providerId];
  if (!base) return null;
  return {
    small:  getTierModel(providerId, 'small'),
    medium: getTierModel(providerId, 'medium'),
    large:  getTierModel(providerId, 'large'),
  };
}

module.exports = { routeModel, scoreTier, getProviderTiers, DEFAULT_TIERS };
