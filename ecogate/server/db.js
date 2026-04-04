'use strict';

/**
 * db.js — JSON-file persistence layer (zero-dependency)
 *
 * Stores request logs as a JSON file. This is 100% pure Node.js —
 * no native bindings, no compilation, works everywhere.
 *
 * For production you would swap this for PostgreSQL or SQLite.
 * For the hackathon demo this is perfectly fine.
 *
 * Schema (each record):
 *   id           number   auto-incremented
 *   created_at   string   ISO-8601 timestamp
 *   model        string
 *   tier         string   'small' | 'medium' | 'large'
 *   provider     string   'openai' | 'anthropic'
 *   tokens_in    number
 *   tokens_out   number
 *   total_tokens number
 *   carbon_g     number
 *   baseline_g   number
 *   saved_g      number
 *   latency_ms   number
 *   complexity   number   1–5
 */

const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../ecogate-data.json');

// In-memory store — loaded once at startup, flushed on write
let store = { nextId: 1, requests: [] };

/**
 * Load state from disk (or create a fresh store if file doesn't exist).
 */
function init() {
  if (fs.existsSync(DB_PATH)) {
    try {
      store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      console.log(`[DB] Loaded ${store.requests.length} records from ${DB_PATH}`);
    } catch (err) {
      console.warn('[DB] Could not parse DB file — starting fresh.', err.message);
      store = { nextId: 1, requests: [] };
    }
  } else {
    console.log(`[DB] No existing DB found. Starting fresh at ${DB_PATH}`);
  }
}

/**
 * Write in-memory store to disk (synchronous for simplicity).
 */
function _flush() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Insert a request log entry.
 *
 * @param {object} entry
 */
function insertRequest(entry) {
  const record = {
    id:         store.nextId++,
    created_at: new Date().toISOString(),
    ...entry,
  };
  store.requests.push(record);

  // Keep max 50 000 records to avoid unbounded memory/disk growth
  if (store.requests.length > 50000) {
    store.requests = store.requests.slice(-50000);
  }

  _flush();
  return record;
}

/**
 * Fetch the most recent N request logs (newest first).
 *
 * @param {number} [limit=100]
 * @returns {Array<object>}
 */
function getRecentLogs(limit = 100) {
  return store.requests.slice(-limit).reverse();
}

/**
 * Aggregate stats for the dashboard.
 */
function getStats() {
  const reqs = store.requests;

  const total_requests = reqs.length;
  const total_carbon_g = reqs.reduce((s, r) => s + (r.carbon_g  || 0), 0);
  const total_saved_g  = reqs.reduce((s, r) => s + (r.saved_g   || 0), 0);
  const total_tokens   = reqs.reduce((s, r) => s + (r.total_tokens || 0), 0);

  // Group by model
  const modelMap = {};
  for (const r of reqs) {
    if (!modelMap[r.model]) modelMap[r.model] = { count: 0, carbon_g: 0 };
    modelMap[r.model].count    += 1;
    modelMap[r.model].carbon_g += r.carbon_g || 0;
  }
  const by_model = Object.entries(modelMap)
    .map(([model, v]) => ({ model, count: v.count, carbon_g: +v.carbon_g.toFixed(6) }))
    .sort((a, b) => b.count - a.count);

  return {
    total_requests,
    total_carbon_g: +total_carbon_g.toFixed(6),
    total_saved_g:  +total_saved_g.toFixed(6),
    total_tokens,
    by_model,
  };
}

/**
 * Fetch carbon saved grouped by day.
 *
 * @param {number} [days=30]
 * @returns {Array<{ date: string, saved_g: number, requests: number }>}
 */
function getDailyStats(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const dayMap = {};
  for (const r of store.requests) {
    if (r.created_at < cutoff) continue;
    const date = r.created_at.slice(0, 10); // YYYY-MM-DD
    if (!dayMap[date]) dayMap[date] = { saved_g: 0, requests: 0 };
    dayMap[date].saved_g  += r.saved_g || 0;
    dayMap[date].requests += 1;
  }

  return Object.entries(dayMap)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, saved_g: +d.saved_g.toFixed(6), requests: d.requests }));
}

module.exports = { init, insertRequest, getRecentLogs, getStats, getDailyStats };
