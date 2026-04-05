'use strict';

/**
 * EcoGate Demo Data Seeder
 * Inserts 1000 realistic requests into SQLite for dashboard demo.
 * Run: node seed.js [--count=N] [--clear]
 *
 * Flags:
 *   --clear    wipe existing rows before seeding
 *   --count=N  number of rows (default 1000)
 */

require('dotenv').config();

const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'ecogate.db');
const db      = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ─── Ensure all columns exist (same migration as db.js) ─────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp         TEXT    NOT NULL,
    provider          TEXT    NOT NULL,
    model             TEXT    NOT NULL,
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    latency_ms        INTEGER NOT NULL DEFAULT 0,
    complexity_score  INTEGER,
    complexity_source TEXT,
    routing_tier      TEXT,
    was_routed        INTEGER NOT NULL DEFAULT 0,
    carbon_g          REAL    NOT NULL DEFAULT 0,
    baseline_carbon_g REAL    NOT NULL DEFAULT 0,
    savings_g         REAL    NOT NULL DEFAULT 0
  );
`);

const existingCols = db.pragma('table_info(requests)').map((c) => c.name);
const newCols = [
  ['complexity_score',  'INTEGER'],
  ['complexity_source', 'TEXT'],
  ['routing_tier',      'TEXT'],
  ['was_routed',        'INTEGER NOT NULL DEFAULT 0'],
  ['carbon_g',          'REAL    NOT NULL DEFAULT 0'],
  ['baseline_carbon_g', 'REAL    NOT NULL DEFAULT 0'],
  ['savings_g',         'REAL    NOT NULL DEFAULT 0'],
];
for (const [col, type] of newCols) {
  if (!existingCols.includes(col)) db.exec(`ALTER TABLE requests ADD COLUMN ${col} ${type}`);
}

// ─── Config ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const COUNT  = parseInt((args.find((a) => a.startsWith('--count=')) || '--count=1000').split('=')[1], 10);
const CLEAR  = args.includes('--clear');

if (CLEAR) {
  db.exec('DELETE FROM requests');
  console.log('🗑  Cleared existing rows.');
}

// ─── Realistic distributions ─────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'openai',    weight: 50 },
  { id: 'anthropic', weight: 20 },
  { id: 'google',    weight: 15 },
  { id: 'groq',      weight: 10 },
  { id: 'mistral',   weight: 5  },
];

const TIER_MODELS = {
  openai:    { small: 'gpt-4o-mini',             medium: 'gpt-4o',                    large: 'gpt-4-turbo' },
  anthropic: { small: 'claude-3-haiku-20240307', medium: 'claude-3-5-sonnet-20241022', large: 'claude-3-opus-20240229' },
  google:    { small: 'gemini-1.5-flash',        medium: 'gemini-1.5-pro',            large: 'gemini-1.5-pro' },
  groq:      { small: 'llama-3.1-8b-instant',   medium: 'llama-3.1-70b-versatile',   large: 'llama-3.1-70b-versatile' },
  mistral:   { small: 'mistral-small-latest',    medium: 'mistral-medium-latest',     large: 'mistral-large-latest' },
};

const CARBON_FACTORS = { small: 0.02, medium: 0.15, large: 0.45 };

// Complexity scores weighted toward simple (realistic — most queries are simple)
const SCORE_WEIGHTS = [
  { score: 1, tier: 'small',  weight: 20 },
  { score: 2, tier: 'small',  weight: 30 },
  { score: 3, tier: 'medium', weight: 25 },
  { score: 4, tier: 'large',  weight: 15 },
  { score: 5, tier: 'large',  weight: 10 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function weightedPick(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.weight; if (r <= 0) return item; }
  return items[items.length - 1];
}

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max, dp = 6) { return parseFloat((Math.random() * (max - min) + min).toFixed(dp)); }

// Timestamps spread over the last 7 days
function randomTimestamp() {
  const now  = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return new Date(now - Math.random() * week).toISOString();
}

// ─── Insert ───────────────────────────────────────────────────────────────────
const insert = db.prepare(`
  INSERT INTO requests (
    timestamp, provider, model,
    tokens_in, tokens_out, latency_ms,
    complexity_score, complexity_source, routing_tier, was_routed,
    carbon_g, baseline_carbon_g, savings_g
  ) VALUES (
    @timestamp, @provider, @model,
    @tokens_in, @tokens_out, @latency_ms,
    @complexity_score, @complexity_source, @routing_tier, @was_routed,
    @carbon_g, @baseline_carbon_g, @savings_g
  )
`);

const seedMany = db.transaction((rows) => { for (const r of rows) insert.run(r); });

// ─── Generate rows ────────────────────────────────────────────────────────────
const rows = [];

for (let i = 0; i < COUNT; i++) {
  const provider     = weightedPick(PROVIDERS);
  const complexity   = weightedPick(SCORE_WEIGHTS);
  const tier         = complexity.tier;
  const model        = TIER_MODELS[provider.id][tier];

  const tokens_in    = randInt(20,  800);
  const tokens_out   = randInt(10,  400);
  const total_tokens = tokens_in + tokens_out;

  const factor          = CARBON_FACTORS[tier];
  const baseline_factor = CARBON_FACTORS.large;

  const carbon_g          = parseFloat(((total_tokens / 1000) * factor).toFixed(6));
  const baseline_carbon_g = parseFloat(((total_tokens / 1000) * baseline_factor).toFixed(6));
  const savings_g         = parseFloat((baseline_carbon_g - carbon_g).toFixed(6));

  rows.push({
    timestamp:         randomTimestamp(),
    provider:          provider.id,
    model,
    tokens_in,
    tokens_out,
    latency_ms:        randInt(80, 2500),
    complexity_score:  complexity.score,
    complexity_source: Math.random() > 0.05 ? 'llm' : 'fallback',
    routing_tier:      tier,
    was_routed:        1,
    carbon_g,
    baseline_carbon_g,
    savings_g,
  });
}

seedMany(rows);

// ─── Summary ─────────────────────────────────────────────────────────────────
const totals = db.prepare(`
  SELECT
    COUNT(*) AS total,
    ROUND(SUM(carbon_g), 4)          AS carbon_g,
    ROUND(SUM(savings_g), 4)         AS savings_g,
    ROUND(AVG(latency_ms))           AS avg_ms
  FROM requests
`).get();

console.log(`✅ Seeded ${COUNT} rows into ${DB_PATH}`);
console.log(`   Total rows now: ${totals.total}`);
console.log(`   Carbon emitted: ${totals.carbon_g}g`);
console.log(`   Carbon saved:   ${totals.savings_g}g`);
console.log(`   Avg latency:    ${totals.avg_ms}ms`);
