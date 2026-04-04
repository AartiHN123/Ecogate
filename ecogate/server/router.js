'use strict';

/**
 * router.js — Model Selection Engine
 *
 * Maps a complexity score (1–5) to the optimal model for a given provider.
 * The goal is to use the smallest model that can handle the task, reducing
 * GPU energy consumption and therefore carbon emissions.
 *
 * Routing table (mirrors eco_gate.md §5.4):
 *   Score 1–2 → small  model (~90% carbon savings vs baseline)
 *   Score 3   → medium model (~60% carbon savings vs baseline)
 *   Score 4–5 → large  model (baseline — no savings, but required for quality)
 */

const ROUTING_TABLE = {
  openai: {
    small:  'gpt-4o-mini',
    medium: 'gpt-4o',
    large:  'gpt-4',
  },
  anthropic: {
    small:  'claude-haiku-3-5',
    medium: 'claude-sonnet-4-5',
    large:  'claude-opus-4-5',
  },
};

/**
 * Determine the complexity tier from a numeric score.
 *
 * @param {number} score - Integer 1–5 from the classifier.
 * @returns {'small'|'medium'|'large'}
 */
function scoreTier(score) {
  if (score <= 2) return 'small';
  if (score === 3) return 'medium';
  return 'large';
}

/**
 * Select the optimal model given a complexity score and preferred provider.
 *
 * @param {number} score        - Classifier score 1–5.
 * @param {string} [provider]   - 'openai' | 'anthropic'. Defaults to 'openai'.
 * @returns {{ model: string, tier: string, provider: string }}
 */
function selectModel(score, provider = 'openai') {
  const table = ROUTING_TABLE[provider] ?? ROUTING_TABLE.openai;
  const tier   = scoreTier(score);
  const model  = table[tier];

  console.log(`[Router] score=${score} → tier=${tier} model=${model} provider=${provider}`);

  return { model, tier, provider: provider in ROUTING_TABLE ? provider : 'openai' };
}

/**
 * Given the requested model string, infer which provider to use.
 * Falls back to 'openai' for unknown models.
 *
 * @param {string} modelName
 * @returns {'openai'|'anthropic'}
 */
function inferProvider(modelName = '') {
  if (modelName.startsWith('claude')) return 'anthropic';
  return 'openai';
}

module.exports = { selectModel, inferProvider, scoreTier, ROUTING_TABLE };
