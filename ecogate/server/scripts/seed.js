'use strict';

/**
 * scripts/seed.js
 *
 * Seeds the database with realistic demo data so the dashboard looks impressive.
 * Run with: npm run seed
 *
 * Generates 1 000 requests spread over the last 30 days.
 * Does NOT require OPENAI_API_KEY — only writes to the JSON data store.
 */

const path = require('path');
const fs   = require('fs');

const MODELS = require('../models.json');

// Resolve DB path (same default as db.js)
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../../ecogate-data.json');

// ── Load or create the store ─────────────────────────────────────────────────
let store = { nextId: 1, requests: [] };
if (fs.existsSync(DB_PATH)) {
  try {
    store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    console.log(`[Seed] Existing store found with ${store.requests.length} records.`);
  } catch (_) {
    console.warn('[Seed] Could not parse existing DB — starting fresh.');
  }
}

// ── Distribution: [model, tier, provider, complexity, weight] ────────────────
const DISTRIBUTIONS = [
  ['gpt-4o-mini',      'small',  'openai',    2, 40],
  ['gpt-4o-mini',      'small',  'openai',    1, 20],
  ['gpt-4o',           'medium', 'openai',    3, 20],
  ['gpt-4',            'large',  'openai',    5,  8],
  ['gpt-4',            'large',  'openai',    4,  7],
  ['claude-haiku-3-5', 'small',  'anthropic', 2,  3],
  ['claude-sonnet-4-5','medium', 'anthropic', 3,  1],
  ['claude-opus-4-5',  'large',  'anthropic', 5,  1],
];

const TOTAL_WEIGHT = DISTRIBUTIONS.reduce((s, d) => s + d[4], 0);

function weightedRandom() {
  let rand = Math.random() * TOTAL_WEIGHT;
  for (const d of DISTRIBUTIONS) { rand -= d[4]; if (rand <= 0) return d; }
  return DISTRIBUTIONS[DISTRIBUTIONS.length - 1];
}

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function baselineFactor(provider) {
  const factors = Object.values(MODELS)
    .filter(m => m.provider === provider && m.tier === 'large')
    .map(m => m.carbon_per_1k_tokens_g);
  return Math.max(...factors, 0.45);
}

const NOW            = Date.now();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NUM_REQUESTS   = 1000;

for (let i = 0; i < NUM_REQUESTS; i++) {
  const [model, tier, provider, complexity] = weightedRandom();
  const tokensIn    = randBetween(50, 800);
  const tokensOut   = randBetween(30, 400);
  const totalTokens = tokensIn + tokensOut;
  const factor      = MODELS[model]?.carbon_per_1k_tokens_g ?? 0.15;
  const baseFactor  = baselineFactor(provider);

  const carbon_g   = +((totalTokens / 1000) * factor).toFixed(6);
  const baseline_g = +((totalTokens / 1000) * baseFactor).toFixed(6);
  const saved_g    = +(Math.max(0, baseline_g - carbon_g)).toFixed(6);
  const latency_ms = randBetween(200, 2500);

  store.requests.push({
    id:           store.nextId++,
    created_at:   new Date(NOW - Math.floor(Math.random() * THIRTY_DAYS_MS)).toISOString(),
    model, tier, provider,
    tokens_in:    tokensIn,
    tokens_out:   tokensOut,
    total_tokens: totalTokens,
    carbon_g, baseline_g, saved_g, latency_ms, complexity,
  });
}

fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
console.log(`[Seed] ✅ Inserted ${NUM_REQUESTS} demo requests → ${DB_PATH}`);
process.exit(0);
