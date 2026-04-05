'use strict';

/**
 * EcoGate Carbon Calculator Engine
 *
 * Formula:
 *   carbon_g = (total_tokens / 1000) * carbonFactor_gCO2_per_1k_tokens
 *
 * Savings are calculated by comparing the actual model used (routed)
 * against what it would have cost to use the large-tier model.
 *
 * Carbon factors come from models.json — same file used by the router.
 */

const MODELS = require('./models.json');

// ─── Fallback carbon factors (gCO2 per 1k tokens) ───────────────────────────
const TIER_FACTORS = {
  small:  MODELS.carbonFactors.small_model,     // 0.30
  medium: MODELS.carbonFactors.medium_model,    // 0.35
  large:  MODELS.carbonFactors.large_model,     // 17.80
  reasoning: MODELS.carbonFactors.reasoning_model, // 17.50
};
const DEFAULT_FACTOR = TIER_FACTORS.medium; // safe fallback

/**
 * Look up the carbon factor for a model.
 * Priority: models.json exact match → tier fallback → default.
 *
 * @param {string} modelName   e.g. 'gpt-5.4-nano'
 * @param {string} providerId  e.g. 'openai'
 * @returns {number} gCO2 per 1,000 tokens
 */
function getCarbonFactor(modelName, providerId) {
  const provider = MODELS.providers[providerId];
  if (provider) {
    const modelData = provider.models[modelName];
    if (modelData?.carbonFactor_gCO2_per_1k_tokens != null) {
      return modelData.carbonFactor_gCO2_per_1k_tokens;
    }
    // Tier-based fallback using router tier for this model
    if (modelData?.tier && TIER_FACTORS[modelData.tier] != null) {
      return TIER_FACTORS[modelData.tier];
    }
  }

  // Cross-provider scan by model name
  for (const p of Object.values(MODELS.providers)) {
    const modelData = p.models[modelName];
    if (modelData?.carbonFactor_gCO2_per_1k_tokens != null) {
      return modelData.carbonFactor_gCO2_per_1k_tokens;
    }
  }

  console.warn(`[Carbon] Unknown model "${modelName}" — using default factor ${DEFAULT_FACTOR}`);
  return DEFAULT_FACTOR;
}

/**
 * Get the large-tier model's carbon factor for a provider.
 * Used as the "what-if baseline" for savings calculation.
 *
 * @param {string} providerId
 * @returns {number} gCO2 per 1,000 tokens
 */
function getLargeModelFactor(providerId) {
  const provider = MODELS.providers[providerId];
  if (provider?.tiers?.large) {
    return getCarbonFactor(provider.tiers.large, providerId);
  }
  return TIER_FACTORS.large; // 17.80
}

/**
 * Calculate carbon emissions for a completed request.
 *
 * @param {{
 *   model:       string,
 *   providerId:  string,
 *   tokens_in:   number,
 *   tokens_out:  number,
 * }} params
 * @returns {{
 *   total_tokens:     number,
 *   carbon_factor:    number,   // gCO2/1k tokens for actual model
 *   carbon_g:         number,   // actual gCO2 emitted
 *   baseline_carbon_g: number,  // gCO2 if large model used
 *   savings_g:        number,   // baseline - actual
 *   savings_pct:      number,   // 0-100
 * }}
 */
function calculateCarbon({ model, providerId, tokens_in = 0, tokens_out = 0 }) {
  const total_tokens = tokens_in + tokens_out;

  const carbon_factor    = getCarbonFactor(model, providerId);
  const baseline_factor  = getLargeModelFactor(providerId);

  const carbon_g         = (total_tokens / 1000) * carbon_factor;
  const baseline_carbon_g = (total_tokens / 1000) * baseline_factor;

  const savings_g   = Math.max(0, baseline_carbon_g - carbon_g);
  const savings_pct = baseline_carbon_g > 0
    ? Math.round((savings_g / baseline_carbon_g) * 100)
    : 0;

  return {
    total_tokens,
    carbon_factor,
    carbon_g:          parseFloat(carbon_g.toFixed(6)),
    baseline_carbon_g: parseFloat(baseline_carbon_g.toFixed(6)),
    savings_g:         parseFloat(savings_g.toFixed(6)),
    savings_pct,
  };
}

module.exports = { calculateCarbon, getCarbonFactor, getLargeModelFactor, TIER_FACTORS };
