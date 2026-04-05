'use strict';

/**
 * EcoGate Prompt Cache
 *
 * Two-tier caching to avoid redundant LLM API calls:
 *
 *   Tier 1 — Exact match:
 *     Key: SHA-256(JSON.stringify(messages))
 *     O(1), perfect precision. Catches identical repeated requests.
 *
 *   Tier 2 — Semantic match:
 *     Embedding: Ollama /api/embeddings (nomic-embed-text or fallback to compressor model)
 *     Cosine similarity > CACHE_SEMANTIC_THRESHOLD (default 0.95)
 *     Stored in SQLite as JSON blob. Brute-force scan (fast for <10k entries).
 *     Catches "Fix this bug" vs "Fix this make no mistake" with same code context,
 *     because the FULL message array (including code) is embedded, not just the instruction.
 *
 * Cache key design — why vague prompts don't collide:
 *   Key = f(ALL messages) = f(system + code_context + instruction)
 *   "Fix this" + file_a.py  ≠  "Fix this" + file_b.py   → different embedding → miss
 *   "Fix this" + file_a.py  ≈  "Fix this bug" + file_a.py → cosine > 0.95 → semantic hit
 *
 * Config (env vars):
 *   CACHE_ENABLED              — default true
 *   CACHE_TTL_MS               — TTL in ms (default 3600000 = 1 hour, 0 = no expiry)
 *   CACHE_SEMANTIC_THRESHOLD   — cosine similarity threshold (default 0.95)
 *   CACHE_EMBEDDING_MODEL      — Ollama model for embeddings (default nomic-embed-text)
 *   CACHE_MAX_ENTRIES          — max rows to keep in SQLite (default 5000, oldest evicted)
 */

const crypto   = require('crypto');
const path     = require('path');
const Database = require('better-sqlite3');

// ─── Database setup ────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'ecogate.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS prompt_cache (
    hash        TEXT    PRIMARY KEY,
    embedding   TEXT,                        -- JSON float array
    messages    TEXT    NOT NULL,            -- original messages JSON (for debugging)
    response    TEXT    NOT NULL,            -- cached API response JSON
    provider    TEXT    NOT NULL DEFAULT '',
    model       TEXT    NOT NULL DEFAULT '',
    hit_count   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT                         -- NULL = no expiry
  )
`);

// Indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_expires ON prompt_cache(expires_at)`);

// ─── Prepared statements ───────────────────────────────────────────────────
const stmtInsert = db.prepare(`
  INSERT OR REPLACE INTO prompt_cache
    (hash, embedding, messages, response, provider, model, hit_count, created_at, expires_at)
  VALUES
    (@hash, @embedding, @messages, @response, @provider, @model, 0, datetime('now'), @expires_at)
`);

const stmtGetByHash = db.prepare(`
  SELECT * FROM prompt_cache
  WHERE hash = ?
    AND (expires_at IS NULL OR expires_at > datetime('now'))
`);

const stmtGetAllEmbeddings = db.prepare(`
  SELECT hash, embedding, response, provider, model
  FROM prompt_cache
  WHERE embedding IS NOT NULL
    AND (expires_at IS NULL OR expires_at > datetime('now'))
`);

const stmtBumpHitCount = db.prepare(`
  UPDATE prompt_cache SET hit_count = hit_count + 1 WHERE hash = ?
`);

const stmtEvict = db.prepare(`
  DELETE FROM prompt_cache
  WHERE hash IN (
    SELECT hash FROM prompt_cache
    ORDER BY created_at ASC
    LIMIT ?
  )
`);

const stmtCount = db.prepare(`SELECT COUNT(*) AS n FROM prompt_cache`);

// ─── Helpers ───────────────────────────────────────────────────────────────
function hashMessages(messages) {
  return crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function getExpiresAt() {
  const ttl = parseInt(process.env.CACHE_TTL_MS || '3600000', 10);
  if (ttl === 0) return null;
  return new Date(Date.now() + ttl).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Ollama embedding ──────────────────────────────────────────────────────
const OLLAMA_BASE = (process.env.COMPRESSOR_URL || 'http://localhost:11434').replace('/api', '');
const EMBED_MODEL = process.env.CACHE_EMBEDDING_MODEL || 'nomic-embed-text';

async function getEmbedding(text) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(1000), // 1s max for embedding
    });
    if (!res.ok) throw new Error(`Ollama embedding HTTP ${res.status}`);
    const json = await res.json();
    return json.embedding || null;
  } catch (err) {
    console.warn(`[Cache] Embedding failed: ${err.message}`);
    return null;
  }
}

function messagesToText(messages) {
  return messages.map((m) => `${m.role}: ${m.content || ''}`).join('\n');
}

// ─── Cache eviction ────────────────────────────────────────────────────────
function evictIfNeeded() {
  const max = parseInt(process.env.CACHE_MAX_ENTRIES || '5000', 10);
  const { n } = stmtCount.get();
  if (n > max) {
    stmtEvict.run(n - max);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Look up a cached response for the given messages.
 *
 * @param {Array} messages
 * @returns {Promise<{
 *   hit: boolean,
 *   tier: 'exact'|'semantic'|null,
 *   response: object|null,
 *   similarity: number,
 *   provider: string,
 *   model: string,
 * }>}
 */
async function lookupCache(messages) {
  if ((process.env.CACHE_ENABLED || 'true').toLowerCase() === 'false') {
    return { hit: false, tier: null, response: null, similarity: 1, provider: '', model: '' };
  }

  const hash = hashMessages(messages);

  // ── Tier 1: Exact match ──────────────────────────────────────────────────
  const exact = stmtGetByHash.get(hash);
  if (exact) {
    stmtBumpHitCount.run(hash);
    console.log(`[Cache] EXACT HIT — hash ${hash.slice(0, 8)}`);
    return {
      hit:        true,
      tier:       'exact',
      response:   JSON.parse(exact.response),
      similarity: 1,
      provider:   exact.provider,
      model:      exact.model,
    };
  }

  // ── Tier 2: Semantic match ───────────────────────────────────────────────
  const threshold = parseFloat(process.env.CACHE_SEMANTIC_THRESHOLD || '0.95');
  const queryText = messagesToText(messages);
  const queryEmb  = await getEmbedding(queryText);

  if (queryEmb) {
    const candidates = stmtGetAllEmbeddings.all();
    let bestSim  = -1;
    let bestRow  = null;

    for (const row of candidates) {
      if (!row.embedding) continue;
      const emb = JSON.parse(row.embedding);
      const sim = cosineSimilarity(queryEmb, emb);
      if (sim > bestSim) {
        bestSim = sim;
        bestRow = row;
      }
    }

    if (bestRow && bestSim >= threshold) {
      stmtBumpHitCount.run(bestRow.hash);
      console.log(`[Cache] SEMANTIC HIT — similarity ${bestSim.toFixed(4)} | hash ${bestRow.hash.slice(0, 8)}`);
      return {
        hit:        true,
        tier:       'semantic',
        response:   JSON.parse(bestRow.response),
        similarity: bestSim,
        provider:   bestRow.provider,
        model:      bestRow.model,
      };
    }
  }

  return { hit: false, tier: null, response: null, similarity: 0, provider: '', model: '' };
}

/**
 * Store a response in the cache (fire-and-forget friendly — awaiting is optional).
 *
 * @param {Array}  messages  — original (pre-compression) messages
 * @param {object} response  — full API response object
 * @param {string} provider
 * @param {string} model
 */
async function storeCache(messages, response, provider = '', model = '') {
  if ((process.env.CACHE_ENABLED || 'true').toLowerCase() === 'false') return;

  evictIfNeeded();

  const hash    = hashMessages(messages);
  const text    = messagesToText(messages);
  const embedding = await getEmbedding(text);

  stmtInsert.run({
    hash,
    embedding:  embedding ? JSON.stringify(embedding) : null,
    messages:   JSON.stringify(messages),
    response:   JSON.stringify(response),
    provider,
    model,
    expires_at: getExpiresAt(),
  });

  console.log(`[Cache] Stored — hash ${hash.slice(0, 8)} | embedding: ${embedding ? 'yes' : 'no'}`);
}

/**
 * Invalidate a specific cache entry by messages.
 */
function invalidateCache(messages) {
  const hash = hashMessages(messages);
  db.prepare('DELETE FROM prompt_cache WHERE hash = ?').run(hash);
}

/**
 * Return cache statistics for the dashboard.
 */
function getCacheStats() {
  return db.prepare(`
    SELECT
      COUNT(*)        AS total_entries,
      SUM(hit_count)  AS total_hits
    FROM prompt_cache
    WHERE (expires_at IS NULL OR expires_at > datetime('now'))
  `).get();
}

module.exports = { lookupCache, storeCache, invalidateCache, getCacheStats };
