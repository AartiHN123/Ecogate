'use strict';

/**
 * model-sync.js
 *
 * Fetches the live model list from every configured provider,
 * classifies each model into one of three buckets:
 *
 *   small  (score 1-2) → cheapest / fastest
 *   medium (score 3)   → balanced
 *   large  (score 4-5) → most capable
 *
 * Results are written to model-cache.json and kept in memory.
 * Call syncAllProviders() on startup; it re-runs every REFRESH_MS.
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { PROVIDERS, getApiKey } = require('./providers');

const CACHE_FILE  = path.join(__dirname, 'model-cache.json');
const REFRESH_MS  = 6 * 60 * 60 * 1000; // 6 hours

// ─── In-memory store: { [providerId]: { small, medium, large, fetchedAt } }
let _cache = {};

// ─── Bucket classification ─────────────────────────────────────────────────
//
// Rules applied in order — first match wins.
// Pattern matching is done on the lowercase model ID.

const SMALL_PATTERNS = [
  /mini/,
  /flash/,
  /haiku/,
  /\bsmall\b/,
  /instant/,
  /lite/,
  /light/,
  /8b/,
  /7b/,
  /\b3b\b/,
  /\b1b\b/,
  /air/,          // glm-4-air
  /gemma/,
];

const LARGE_PATTERNS = [
  /opus/,
  /\blarge\b/,
  /\bmax\b/,
  /ultra/,
  /plus/,         // glm-4-plus
  /70b/,
  /\b4-turbo\b/,
  /gpt-4(?!o)/,   // gpt-4 but NOT gpt-4o
];

// Everything that matches neither goes to medium.

function classifyModel(modelId) {
  const id = modelId.toLowerCase();
  if (SMALL_PATTERNS.some((p) => p.test(id))) return 'small';
  if (LARGE_PATTERNS.some((p) => p.test(id))) return 'large';
  return 'medium';
}

// ─── Fetch models from one provider ───────────────────────────────────────
async function fetchProviderModels(provider) {
  const apiKey = getApiKey(provider);
  if (!apiKey) return null; // skip unconfigured providers

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: provider.baseURL,
      defaultHeaders: provider.extraHeaders || {},
      timeout: 10_000,
    });

    const response = await client.models.list();
    const modelIds = response.data.map((m) => m.id);

    const buckets = { small: [], medium: [], large: [] };
    for (const id of modelIds) {
      buckets[classifyModel(id)].push(id);
    }

    // Sort each bucket alphabetically for stable ordering
    for (const tier of Object.keys(buckets)) {
      buckets[tier].sort();
    }

    return { ...buckets, fetchedAt: new Date().toISOString(), source: 'live' };
  } catch (err) {
    console.warn(`[model-sync] ${provider.name}: fetch failed (${err.message}). Using static fallback.`);
    return null;
  }
}

// ─── Build static fallback buckets from providers.js definitions ───────────
function staticFallback(provider) {
  const buckets = { small: [], medium: [], large: [] };
  for (const id of provider.models) {
    buckets[classifyModel(id)].push(id);
  }
  return { ...buckets, fetchedAt: new Date().toISOString(), source: 'static' };
}

// ─── Sync all configured providers ────────────────────────────────────────
async function syncAllProviders() {
  console.log('[model-sync] Syncing model lists...');

  const results = {};

  await Promise.allSettled(
    Object.values(PROVIDERS).map(async (provider) => {
      const live = await fetchProviderModels(provider);
      results[provider.id] = live || staticFallback(provider);
      const src = results[provider.id].source;
      const counts = ['small','medium','large'].map(
        (t) => `${t}:${results[provider.id][t].length}`
      ).join(' ');
      console.log(`[model-sync]  ${provider.name.padEnd(16)} [${src}]  ${counts}`);
    })
  );

  _cache = results;

  // Persist to disk so it survives restarts
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.warn('[model-sync] Could not write cache file:', e.message);
  }

  console.log('[model-sync] Done. Next sync in 6 hours.');
  return _cache;
}

// ─── Load cache from disk on first require ─────────────────────────────────
function loadCacheFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      _cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log('[model-sync] Loaded model cache from disk.');
    }
  } catch {
    // ignore corrupt cache
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Get bucketed models for a provider.
 * Returns { small: [], medium: [], large: [] } — always has all three keys.
 * Falls back to static list if provider not in cache yet.
 */
function getBuckets(providerId) {
  if (_cache[providerId]) return _cache[providerId];

  // Not in cache yet — use static fallback immediately
  const provider = PROVIDERS[providerId];
  if (!provider) return { small: [], medium: [], large: [] };
  return staticFallback(provider);
}

/**
 * Pick the best available model for a score from a provider's buckets.
 * Returns a model ID string.
 *
 * Score 1-2 → small, Score 3 → medium, Score 4-5 → large
 * Falls through to next tier if preferred tier is empty.
 */
function pickModel(providerId, score) {
  const buckets = getBuckets(providerId);
  const provider = PROVIDERS[providerId];

  const tiers =
    score <= 2 ? ['small', 'medium', 'large']
    : score === 3 ? ['medium', 'small', 'large']
    : ['large', 'medium', 'small'];

  for (const tier of tiers) {
    if (buckets[tier] && buckets[tier].length > 0) {
      return buckets[tier][0]; // first = alphabetically first, good enough
    }
  }

  // Last resort: provider's hardcoded default
  return provider?.defaultModel || 'gpt-4o-mini';
}

/**
 * Start background sync: run once now, then every 6 hours.
 * Safe to call multiple times — only schedules one timer.
 */
let _started = false;
function startSync() {
  if (_started) return;
  _started = true;

  loadCacheFromDisk();
  syncAllProviders(); // fire and forget — don't block startup
  setInterval(syncAllProviders, REFRESH_MS).unref(); // .unref() won't block process exit
}

module.exports = { startSync, syncAllProviders, getBuckets, pickModel };
