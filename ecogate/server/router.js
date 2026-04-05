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
 *   ROUTER_<PROVIDER_ID>_SMALL   e.g. ROUTER_OPENAI_SMALL=gpt-4o-mini
 *   ROUTER_<PROVIDER_ID>_MEDIUM  e.g. ROUTER_OPENAI_MEDIUM=gpt-4o
 *   ROUTER_<PROVIDER_ID>_LARGE   e.g. ROUTER_OPENAI_LARGE=gpt-4-turbo
 */

// ─── Default model tiers per provider ───────────────────────────────────────
// Keys must match provider IDs in providers.js
const DEFAULT_TIERS = {
  openai: {
    small:  'gpt-4o-mini',
    medium: 'gpt-4o',
    large:  'gpt-4-turbo',
  },
  anthropic: {
    small:  'claude-3-haiku-20240307',
    medium: 'claude-3-5-sonnet-20241022',
    large:  'claude-3-opus-20240229',
  },
  google: {
    small:  'gemini-1.5-flash',
    medium: 'gemini-1.5-pro',
    large:  'gemini-1.5-pro',   // no larger model yet; use pro for both
  },
  zai: {
    small:  'glm-4-flash',
    medium: 'glm-4-air',
    large:  'glm-4-plus',
  },
  groq: {
    small:  'llama-3.1-8b-instant',
    medium: 'llama-3.1-70b-versatile',
    large:  'llama-3.1-70b-versatile', // groq's largest available
  },
  mistral: {
    small:  'mistral-small-latest',
    medium: 'mistral-medium-latest',
    large:  'mistral-large-latest',
  },
  together: {
    small:  'meta-llama/Llama-3-8b-chat-hf',
    medium: 'meta-llama/Llama-3-70b-chat-hf',
    large:  'meta-llama/Llama-3-70b-chat-hf',
  },

  // Local Ollama — no cloud dependency.
  // Override via ROUTER_OLLAMA_SMALL / _MEDIUM / _LARGE env vars.
  ollama: {
    small:  'gemma4:e4b',
    medium: 'gemma4:e4b',
    large:  'gemma4:e4b',
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
