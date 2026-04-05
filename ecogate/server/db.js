'use strict';

const path = require('path');
const Database = require('better-sqlite3');

// Database lives next to this file — ecogate/server/ecogate.db
const DB_PATH = path.join(__dirname, 'ecogate.db');

const db = new Database(DB_PATH);

// Improve write performance — safe for single-process use
db.pragma('journal_mode = WAL');

// ─── Schema ────────────────────────────────────────────────────────────────
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

// Migrate existing DB: add new columns if they don't exist (safe no-op if present)
const existingCols = db.pragma('table_info(requests)').map((c) => c.name);
const newCols = [
  ['complexity_score',   'INTEGER'],
  ['complexity_source',  'TEXT'],
  ['routing_tier',       'TEXT'],
  ['was_routed',         'INTEGER NOT NULL DEFAULT 0'],
  ['carbon_g',           'REAL    NOT NULL DEFAULT 0'],
  ['baseline_carbon_g',  'REAL    NOT NULL DEFAULT 0'],
  ['savings_g',          'REAL    NOT NULL DEFAULT 0'],
  // Compression metrics
  ['original_tokens',    'INTEGER'],
  ['compressed_tokens',  'INTEGER'],
  ['compression_ratio',  'REAL'],
  // Cache metrics
  ['cache_hit',          'INTEGER NOT NULL DEFAULT 0'],
  ['cache_tier',         'TEXT'],
  ['original_prompt',    'TEXT'],
  ['compressed_prompt',  'TEXT'],
  ['compression_model',  'TEXT'],
];
for (const [col, type] of newCols) {
  if (!existingCols.includes(col)) {
    db.exec(`ALTER TABLE requests ADD COLUMN ${col} ${type}`);
  }
}

// ─── Prepared statements ───────────────────────────────────────────────────
const insertRequest = db.prepare(`
  INSERT INTO requests (
    timestamp, provider, model,
    tokens_in, tokens_out, latency_ms,
    complexity_score, complexity_source, routing_tier, was_routed,
    carbon_g, baseline_carbon_g, savings_g,
    original_tokens, compressed_tokens, compression_ratio,
    cache_hit, cache_tier,
    original_prompt, compressed_prompt, compression_model
  ) VALUES (
    @timestamp, @provider, @model,
    @tokens_in, @tokens_out, @latency_ms,
    @complexity_score, @complexity_source, @routing_tier, @was_routed,
    @carbon_g, @baseline_carbon_g, @savings_g,
    @original_tokens, @compressed_tokens, @compression_ratio,
    @cache_hit, @cache_tier,
    @original_prompt, @compressed_prompt, @compression_model
  )
`);

const selectLogs = db.prepare(`
  SELECT * FROM requests
  ORDER BY id DESC
  LIMIT @limit
`);

const selectStats = db.prepare(`
  SELECT
    provider,
    routing_tier,
    COUNT(*)              AS count,
    SUM(tokens_in)        AS total_tokens_in,
    SUM(tokens_out)       AS total_tokens_out,
    AVG(latency_ms)       AS avg_latency_ms,
    SUM(carbon_g)         AS carbon_g,
    SUM(baseline_carbon_g) AS baseline_carbon_g,
    SUM(savings_g)        AS savings_g
  FROM requests
  GROUP BY provider, routing_tier
  ORDER BY count DESC
`);

const selectModelStats = db.prepare(`
  SELECT
    model,
    COUNT(*) AS count
  FROM requests
  GROUP BY model
  ORDER BY count DESC
`);

const selectCompressionStats = db.prepare(`
  SELECT 
    SUM(original_tokens) AS total_original,
    SUM(compressed_tokens) AS total_compressed,
    AVG(compression_ratio) AS avg_ratio,
    MAX(CAST(original_tokens AS FLOAT) / compressed_tokens) AS max_ratio
  FROM requests
  WHERE compressed_tokens > 0 AND original_tokens > 0
`);

const selectTotals = db.prepare(`
  SELECT
    COUNT(*)              AS total_requests,
    SUM(tokens_in)        AS total_tokens_in,
    SUM(tokens_out)       AS total_tokens_out,
    AVG(latency_ms)       AS avg_latency_ms,
    SUM(carbon_g)         AS total_carbon_g,
    SUM(baseline_carbon_g) AS total_baseline_carbon_g,
    SUM(savings_g)        AS total_savings_g
  FROM requests
`);

// ─── Exported helpers ──────────────────────────────────────────────────────

/**
 * Log one completed request.
 * @param {{
 *   provider, model, tokens_in, tokens_out, latency_ms,
 *   complexity_score, complexity_source, routing_tier, was_routed,
 *   carbon_g, baseline_carbon_g, savings_g
 * }} row
 */
function logRequest(row) {
  insertRequest.run({
    timestamp:          new Date().toISOString(),
    provider:           row.provider,
    model:              row.model,
    tokens_in:          row.tokens_in           || 0,
    tokens_out:         row.tokens_out          || 0,
    latency_ms:         row.latency_ms          || 0,
    complexity_score:   row.complexity_score    ?? null,
    complexity_source:  row.complexity_source   ?? null,
    routing_tier:       row.routing_tier        ?? null,
    was_routed:         row.was_routed          ?? 0,
    carbon_g:           row.carbon_g            || 0,
    baseline_carbon_g:  row.baseline_carbon_g   || 0,
    savings_g:          row.savings_g           || 0,
    // Compression
    original_tokens:    row.original_tokens     ?? null,
    compressed_tokens:  row.compressed_tokens   ?? null,
    compression_ratio:  row.compression_ratio   ?? null,
    // Cache
    cache_hit:          row.cache_hit           ?? 0,
    cache_tier:         row.cache_tier          ?? null,
    // Add these
    original_prompt:    row.original_prompt     ?? null,
    compressed_prompt:  row.compressed_prompt   ?? null,
    compression_model:  row.compression_model   ?? null,
  });
}

/**
 * Return the N most recent requests (default 100).
 */
function getLogs(limit = 100) {
  return selectLogs.all({ limit });
}

/**
 * Return per-provider/tier aggregates + overall totals.
 */
function getStats() {
  const totals    = selectTotals.get();
  const breakdown = selectStats.all();
  const models    = selectModelStats.all();
  const compression = selectCompressionStats.get();

  // Compute savings_pct at the totals level
  const savings_pct = totals.total_baseline_carbon_g > 0
    ? Math.round((totals.total_savings_g / totals.total_baseline_carbon_g) * 100)
    : 0;

  return {
    totals:    { ...totals, savings_pct },
    breakdown,
    models,
    compression,
  };
}

/**
 * Return per-day (or per-hour) carbon/savings aggregates for the dashboard line chart.
 *
 * @param {'1d'|'7d'|'30d'} period     How far back to look (default '7d').
 * @param {'hour'|'day'}    granularity Time bucket size (default: 'hour' for 1d, 'day' otherwise).
 * @returns {Array<{ bucket: string, requests: number, carbon_g: number, savings_g: number, tokens: number }>}
 */
function getTimeseries(period = '7d', granularity) {
  // Resolve how many hours back to query
  const hoursBack = period === '1d' ? 24 : period === '30d' ? 720 : 168; // default 7d = 168h

  // Auto-select granularity: hourly for 1d, daily for anything longer
  const grain = granularity || (period === '1d' ? 'hour' : 'day');

  // SQLite strftime format string
  const fmt = grain === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%d';

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT
      strftime('${fmt}', timestamp)  AS bucket,
      COUNT(*)                       AS requests,
      ROUND(SUM(carbon_g), 6)        AS carbon_g,
      ROUND(SUM(savings_g), 6)       AS savings_g,
      SUM(tokens_in + tokens_out)    AS tokens
    FROM requests
    WHERE timestamp >= ?
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(cutoff);

  return rows;
}

module.exports = { logRequest, getLogs, getStats, getTimeseries };

