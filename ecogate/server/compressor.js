'use strict';

/**
 * EcoGate Prompt Compressor
 *
 * Compresses user messages via a local Ollama instance (Qwen2.5:1.5b).
 * System messages are NOT compressed — they are deduplicated by SHA-256 hash
 * so identical system prompts aren't resent on every turn.
 *
 * Token counting uses tiktoken (cl100k_base — works for all modern models).
 *
 * Config (env vars):
 *   COMPRESSOR_URL         — default http://localhost:11434/v1
 *   COMPRESSOR_MODEL       — default qwen2.5:1.5b
 *   COMPRESSOR_ENABLED     — default true
 *   MIN_PROMPT_TOKENS      — skip compression below this threshold (default 150)
 *   COMPRESSOR_TIMEOUT_MS  — hard timeout per call (default 500)
 */

const crypto  = require('crypto');
const { OpenAI } = require('openai');
const { get_encoding } = require('tiktoken');

// ─── Token counter ─────────────────────────────────────────────────────────
let _enc = null;
function getEncoding() {
  if (!_enc) _enc = get_encoding('cl100k_base');
  return _enc;
}

function countTokens(text = '') {
  try {
    return getEncoding().encode(text).length;
  } catch {
    return Math.ceil(text.length / 4); // char-based fallback
  }
}

// ─── System message deduplication ─────────────────────────────────────────
// Per-process cache of seen system message hashes.
// If the same system message appears in multiple requests we replace it with
// a lightweight sentinel, saving tokens on every repeated call.
const _seenSystemHashes = new Set();

function deduplicateSystemMessages(messages) {
  return messages.map((msg) => {
    if (msg.role !== 'system') return msg;

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const hash    = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);

    if (_seenSystemHashes.has(hash)) {
      // Already seen — send a compact reference instead
      return { role: 'system', content: `[system:${hash}]` };
    }
    _seenSystemHashes.add(hash);
    return msg; // first occurrence — pass verbatim
  });
}

// ─── Ollama client (lazy) ──────────────────────────────────────────────────
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey:  'ollama', // Ollama ignores the key but SDK requires one
      baseURL: process.env.COMPRESSOR_URL || 'http://localhost:11434/v1',
    });
  }
  return _client;
}

const COMPRESS_SYSTEM = `You are a prompt optimizer. Transform the user's message into a concise, well-structured prompt.

Output format (use only the sections that apply, skip the rest):
**Context:** [brief background if present]
**Task:** [what to do — be direct and specific]
**Constraints:** [rules, format requirements, edge cases]
**Output:** [expected output format if specified]

Rules:
- Total output MUST be shorter than the input (compress while restructuring)
- Preserve ALL technical details: code, file names, variable names, error messages
- Remove filler words, redundancy, and vague phrasing
- If the input is already short and clear, only add structure if it genuinely helps
- Output ONLY the restructured prompt, no meta-commentary`;


/**
 * Compress a single user message string via local Ollama.
 * Returns the original string on timeout or error.
 */
async function compressUserMessage(text, timeoutMs) {
  const client = getClient();
  const model  = process.env.COMPRESSOR_MODEL || 'qwen2.5:1.5b';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: COMPRESS_SYSTEM },
          { role: 'user',   content: text },
        ],
        temperature: 0,
        max_tokens:  Math.ceil(countTokens(text) * 1.2), // can't expand beyond original
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);
    return resp.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
      console.warn('[Compressor] Timeout — using original message');
    } else {
      console.warn(`[Compressor] Error — using original message: ${err.message}`);
    }
    return text;
  }
}

/**
 * Compress an incoming messages array.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<{
 *   compressed_messages: Array,
 *   original_tokens:     number,
 *   compressed_tokens:   number,
 *   savings_pct:         number,
 *   skipped:             boolean,
 *   reason:              string,
 * }>}
 */
async function compressPrompt(messages) {
  // Disabled via env
  if ((process.env.COMPRESSOR_ENABLED || 'true').toLowerCase() === 'false') {
    return { compressed_messages: messages, original_tokens: 0, compressed_tokens: 0, savings_pct: 0, skipped: true, reason: 'disabled' };
  }

  // Count tokens in user messages only
  const minTokens   = parseInt(process.env.MIN_PROMPT_TOKENS || '150', 10);
  const timeoutMs   = parseInt(process.env.COMPRESSOR_TIMEOUT_MS || '500', 10);
  const userContent = messages.filter((m) => m.role === 'user').map((m) => m.content || '').join(' ');
  const originalTokens = countTokens(userContent);

  // Skip if prompt is already short
  if (originalTokens < minTokens) {
    return {
      compressed_messages: messages,
      original_tokens:     originalTokens,
      compressed_tokens:   originalTokens,
      savings_pct:         0,
      skipped:             true,
      reason:              'below_threshold',
    };
  }

  // Step 1: Deduplicate system messages
  const deduped = deduplicateSystemMessages(messages);

  // Step 2: Compress user messages
  const compressed = await Promise.all(
    deduped.map(async (msg) => {
      if (msg.role !== 'user') return msg;
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const rewritten = await compressUserMessage(content, timeoutMs);
      return { ...msg, content: rewritten };
    })
  );

  const compressedUserContent = compressed.filter((m) => m.role === 'user').map((m) => m.content || '').join(' ');
  const compressedTokens = countTokens(compressedUserContent);
  const savings = Math.max(0, originalTokens - compressedTokens);
  const savingsPct = originalTokens > 0 ? Math.round((savings / originalTokens) * 100) : 0;

  console.log(
    `[Compressor] ${originalTokens} → ${compressedTokens} tokens | saved ${savings} (${savingsPct}%)`
  );

  return {
    compressed_messages: compressed,
    original_tokens:     originalTokens,
    compressed_tokens:   compressedTokens,
    savings_pct:         savingsPct,
    skipped:             false,
    reason:              'compressed',
  };
}

module.exports = { compressPrompt, countTokens, deduplicateSystemMessages };
