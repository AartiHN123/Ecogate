'use strict';

/**
 * carbon.js — Carbon Calculation Engine
 *
 * Estimates grams of CO2 emitted per inference request based on:
 *   - Model carbon factor (gCO2 per 1 000 tokens) from models.json
 *   - Total tokens consumed (prompt + completion)
 *   - Regional grid carbon intensity (hardcoded to US average for hackathon)
 *
 * Formula (simplified from eco_gate.md §5.3):
 *   carbon_g = total_tokens * (carbon_per_1k_tokens_g / 1000) * grid_intensity_factor
 *
 * "Savings" are calculated by comparing what the carbon WOULD have been if the
 * request was always routed to the largest model in that provider's tier.
 *
 * In production you'd swap the hardcoded grid_intensity_factor for a live call
 * to ElectricityMaps or WattTime. For the hackathon demo this is fine.
 */

const MODELS = require('./models.json');

// US average grid carbon intensity relative to the factor already baked
// into the per-token estimates (which assume a typical hyperscaler data centre).
// Set to 1.0 for now; bump to 1.2 for coal-heavy regions, 0.7 for hydro-heavy.
const GRID_INTENSITY_FACTOR = 1.0;

// Fallback factor when the model isn't in models.json
const DEFAULT_CARBON_FACTOR = 0.15; // Assume medium tier

/**
 * Look up the carbon factor (gCO2 / 1 000 tokens) for a given model.
 *
 * @param {string} modelName
 * @returns {number}
 */
function carbonFactorForModel(modelName) {
  return MODELS[modelName]?.carbon_per_1k_tokens_g ?? DEFAULT_CARBON_FACTOR;
}

/**
 * Find the largest model in the same provider tier (the "worst-case baseline").
 *
 * @param {string} provider - 'openai' | 'anthropic'
 * @returns {number} carbon factor for the large model
 */
function baselineCarbonFactor(provider) {
  const largeModels = Object.values(MODELS).filter(
    (m) => m.provider === provider && m.tier === 'large'
  );
  if (!largeModels.length) return 0.45; // Hard-coded fallback
  return Math.max(...largeModels.map((m) => m.carbon_per_1k_tokens_g));
}

/**
 * Calculate carbon emissions for a completed request.
 *
 * @param {object} opts
 * @param {string} opts.model      - Model that actually handled the request.
 * @param {number} opts.tokensIn   - Prompt token count.
 * @param {number} opts.tokensOut  - Completion token count.
 * @param {string} [opts.provider] - 'openai' | 'anthropic'. Inferred from model if omitted.
 *
 * @returns {{
 *   carbon_g:        number,   // gCO2 emitted by this request
 *   baseline_g:      number,   // gCO2 if always using the large model
 *   saved_g:         number,   // carbon saved (baseline − actual), min 0
 *   total_tokens:    number,
 *   model:           string,
 * }}
 */
function calculate({ model, tokensIn, tokensOut, provider }) {
  const totalTokens    = (tokensIn || 0) + (tokensOut || 0);
  const inferredProv   = provider ?? (MODELS[model]?.provider || 'openai');
  const factor         = carbonFactorForModel(model);
  const baselineFactor = baselineCarbonFactor(inferredProv);

  const carbon_g   = (totalTokens / 1000) * factor        * GRID_INTENSITY_FACTOR;
  const baseline_g = (totalTokens / 1000) * baselineFactor * GRID_INTENSITY_FACTOR;
  const saved_g    = Math.max(0, baseline_g - carbon_g);

  return {
    carbon_g:     +carbon_g.toFixed(6),
    baseline_g:   +baseline_g.toFixed(6),
    saved_g:      +saved_g.toFixed(6),
    total_tokens: totalTokens,
    model,
  };
}

/**
 * Convert grams of CO2 saved into human-friendly equivalencies.
 *
 * @param {number} saved_g - Grams of CO2 saved (cumulative).
 * @returns {{ trees: number, car_miles: number, phones_charged: number }}
 */
function equivalencies(saved_g) {
  const saved_kg = saved_g / 1000;
  return {
    // A mature tree absorbs ~21 kg CO2/year → per-day = 21/365
    trees:          +(saved_kg / (21 / 365)).toFixed(4),
    // Average US car emits 0.404 kg CO2/mile
    car_miles:      +(saved_kg / 0.404).toFixed(4),
    // Charging a smartphone ≈ 0.008855 kg CO2
    phones_charged: +(saved_kg / 0.008855).toFixed(2),
  };
}

module.exports = { calculate, equivalencies, carbonFactorForModel, baselineCarbonFactor };
