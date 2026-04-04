'use strict';

/**
 * EcoGate Complexity Classifier
 *
 * Sends the incoming prompt to a small model and returns a complexity
 * score from 1–5. Supports ALL providers registered in providers.js
 * (OpenAI, Anthropic, Google, Z.AI, Groq, Mistral, Together AI).
 *
 * Provider selection (env vars, in priority order):
 *   CLASSIFIER_PROVIDER   — id from providers.js  (default: 'openai')
 *   CLASSIFIER_MODEL      — override the model    (default: provider's small-tier model)
 *   CLASSIFIER_API_KEY    — override the API key  (default: provider's env key)
 *
 * Score rubric:
 *   1 — Simple factual lookup or greeting
 *   2 — Basic Q&A or formatting task
 *   3 — Moderate reasoning or summarisation
 *   4 — Complex analysis, multi-step reasoning, or code generation
 *   5 — Advanced research, creative writing, or expert-level tasks
 *
 * Falls back to score 3 (medium) on any failure.
 */

const { OpenAI } = require('openai');
const { PROVIDERS } = require('./providers');

// ─── Classifier config ──────────────────────────────────────────────────────
const FALLBACK_SCORE = 3; // medium tier on any failure

/**
 * Small-model defaults per provider — the cheapest/fastest model that can
 * reliably follow the single-digit scoring instruction.
 */
const CLASSIFIER_DEFAULTS = {
  openai:    { model: 'gpt-4o-mini' },
  anthropic: { model: 'claude-3-haiku-20240307' },
  google:    { model: 'gemini-1.5-flash' },
  zai:       { model: 'glm-4-flash' },
  groq:      { model: 'llama-3.1-8b-instant' },
  mistral:   { model: 'mistral-small-latest' },
  together:  { model: 'meta-llama/Llama-3-8b-chat-hf' },
};

/**
 * Resolve classifier config from env vars + providers registry.
 * Priority: env vars > CLASSIFIER_DEFAULTS > providers.js defaultModel.
 */
function resolveClassifierConfig() {
  const providerId = (process.env.CLASSIFIER_PROVIDER || 'openai').toLowerCase();
  const provider   = PROVIDERS[providerId];

  if (!provider) {
    console.warn(`[Classifier] Unknown CLASSIFIER_PROVIDER "${providerId}", falling back to openai`);
    return resolveClassifierConfig.__openai__();
  }

  const apiKey  = process.env.CLASSIFIER_API_KEY || process.env[provider.envKey] || '';
  const model   = process.env.CLASSIFIER_MODEL
    || CLASSIFIER_DEFAULTS[providerId]?.model
    || provider.defaultModel;
  const baseURL = provider.baseURL;
  const extraHeaders = provider.extraHeaders || {};

  return { providerId, apiKey, model, baseURL, extraHeaders };
}
// Attach static fallback used above (avoids a second helper function)
resolveClassifierConfig.__openai__ = () => ({
  providerId:   'openai',
  apiKey:       process.env.CLASSIFIER_API_KEY || process.env.OPENAI_API_KEY || '',
  model:        process.env.CLASSIFIER_MODEL || 'gpt-4o-mini',
  baseURL:      'https://api.openai.com/v1',
  extraHeaders: {},
});

const SYSTEM_PROMPT = `You are a complexity scorer for AI prompts.
Given a user prompt, rate its complexity from 1 to 5 using the following rubric:

  1 = Simple factual lookup, greeting, or trivial question
  2 = Basic Q&A, rephrasing, or simple formatting task
  3 = Moderate reasoning, summarisation, or multi-turn context
  4 = Complex analysis, multi-step reasoning, or code generation
  5 = Advanced research, deep creative writing, or expert-level domain tasks

Respond with ONLY a single digit (1, 2, 3, 4, or 5). No explanation.`;

// Lazy-initialised client — recreated if CLASSIFIER_PROVIDER changes
let _client   = null;
let _clientId = null; // tracks which provider the client was built for

function getClient() {
  const cfg = resolveClassifierConfig();
  if (!cfg.apiKey) return { client: null, cfg };

  // Rebuild if provider changed at runtime (edge case, but safe)
  const cacheKey = `${cfg.providerId}:${cfg.model}`;
  if (!_client || _clientId !== cacheKey) {
    _client = new OpenAI({
      apiKey:         cfg.apiKey,
      baseURL:        cfg.baseURL,
      defaultHeaders: cfg.extraHeaders,
    });
    _clientId = cacheKey;
    console.log(`[Classifier] Using provider: ${cfg.providerId} | model: ${cfg.model}`);
  }
  return { client: _client, cfg };
}

/**
 * Extract a clean 1-5 integer from the model's raw response text.
 * Returns FALLBACK_SCORE if parsing fails.
 */
function parseScore(text = '') {
  const match = (text || '').trim().match(/^([1-5])/);
  if (!match) return FALLBACK_SCORE;
  return parseInt(match[1], 10);
}

/**
 * Classify the complexity of a prompt.
 *
 * @param {string|Array} messages  - Either a plain string prompt OR the
 *                                   full OpenAI messages array from the
 *                                   incoming request body.
 * @returns {Promise<{ score: number, source: 'llm'|'fallback' }>}
 */
async function classifyPrompt(messages) {
  // Normalise: accept raw string or OpenAI messages array
  let userText;
  if (typeof messages === 'string') {
    userText = messages;
  } else if (Array.isArray(messages)) {
    // Join all user/assistant turns; prioritise the last user message
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    userText = lastUser ? lastUser.content : messages.map((m) => m.content).join('\n');
    // Truncate to first 2000 chars — classifier only needs a sample
    userText = (userText || '').slice(0, 2000);
  } else {
    return { score: FALLBACK_SCORE, source: 'fallback', reason: 'invalid_input' };
  }

  const { client, cfg } = getClient();
  if (!client) {
    console.warn(`[Classifier] No API key for provider "${cfg.providerId}" — using fallback score`);
    return { score: FALLBACK_SCORE, source: 'fallback', reason: 'no_api_key', provider: cfg.providerId };
  }

  try {
    const startMs = Date.now();
    const completion = await client.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userText },
      ],
      max_tokens:   5,   // only needs one digit
      temperature:  0,   // deterministic
    });

    const raw   = completion.choices?.[0]?.message?.content ?? '';
    const score = parseScore(raw);
    const ms    = Date.now() - startMs;

    console.log(`[Classifier] Score: ${score} | Provider: ${cfg.providerId} | Model: ${cfg.model} | Raw: "${raw.trim()}" | ${ms}ms`);
    return { score, source: 'llm', provider: cfg.providerId, model: cfg.model, latency_ms: ms };
  } catch (err) {
    console.warn(`[Classifier] LLM call failed (${err?.message}), using fallback score ${FALLBACK_SCORE}`);
    return { score: FALLBACK_SCORE, source: 'fallback', reason: err?.message, provider: cfg.providerId };
  }
}

module.exports = { classifyPrompt, FALLBACK_SCORE, CLASSIFIER_DEFAULTS };
