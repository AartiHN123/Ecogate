'use strict';

/**
 * EcoGate Complexity Classifier
 *
 * Sends the incoming prompt to a local Ollama instance and returns a
 * complexity score from 1–5 to drive model-tier routing.
 *
 * This module is intentionally cloud-free — it uses Ollama's OpenAI-compatible
 * endpoint so no API keys are needed.
 *
 * Config (env vars):
 *   CLASSIFIER_URL    — Ollama base URL  (default: http://localhost:11434/v1)
 *   CLASSIFIER_MODEL  — Ollama model     (default: same model as COMPRESSOR_MODEL / qwen2.5:1.5b)
 *
 * Score rubric:
 *   1 — Simple factual lookup or greeting
 *   2 — Basic Q&A or formatting task
 *   3 — Moderate reasoning or summarisation
 *   4 — Complex analysis, multi-step reasoning, or code generation
 *   5 — Advanced research, creative writing, or expert-level tasks
 *
 * Falls back to score 3 (medium) on any failure.
 *
 * Prerequisite: `ollama serve` must be running locally.
 */

const { OpenAI } = require('openai');

const FALLBACK_SCORE = 3;

const SYSTEM_PROMPT = `You are a complexity scorer for AI prompts.
Given a user prompt, rate its complexity from 1 to 5 using the following rubric:

  1 = Simple factual lookup, greeting, or trivial question
  2 = Basic Q&A, rephrasing, or simple formatting task
  3 = Moderate reasoning, summarisation, or multi-turn context
  4 = Complex analysis, multi-step reasoning, or code generation
  5 = Advanced research, deep creative writing, or expert-level domain tasks

Respond with ONLY a single digit (1, 2, 3, 4, or 5). No explanation.`;

// Lazy-initialised Ollama client
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey:  'ollama', // Ollama ignores this but the SDK requires a non-empty value
      baseURL: process.env.CLASSIFIER_URL || 'http://localhost:11434/v1',
    });
  }
  return _client;
}

function resolveModel() {
  return (
    process.env.CLASSIFIER_MODEL ||
    process.env.COMPRESSOR_MODEL ||
    'qwen2.5:1.5b'
  );
}

function parseScore(text = '') {
  const match = (text || '').trim().match(/^([1-5])/);
  if (!match) return FALLBACK_SCORE;
  return parseInt(match[1], 10);
}

/**
 * Classify the complexity of a prompt via local Ollama.
 *
 * @param {string|Array} messages  Plain string OR OpenAI messages array.
 * @returns {Promise<{ score: number, source: 'llm'|'fallback' }>}
 */
async function classifyPrompt(messages) {
  let userText;

  if (typeof messages === 'string') {
    userText = messages;
  } else if (Array.isArray(messages)) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    userText = lastUser ? lastUser.content : messages.map((m) => m.content).join('\n');
    userText = (userText || '').slice(0, 2000); // classifier only needs a sample
  } else {
    return { score: FALLBACK_SCORE, source: 'fallback', reason: 'invalid_input' };
  }

  const client = getClient();
  const model  = resolveModel();

  try {
    const startMs = Date.now();
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userText },
      ],
      max_tokens:  5,  // only needs one digit
      temperature: 0,  // deterministic
    });

    const raw   = completion.choices?.[0]?.message?.content ?? '';
    const score = parseScore(raw);
    const ms    = Date.now() - startMs;

    console.log(`[Classifier] Score: ${score} | Model: ${model} | Raw: "${raw.trim()}" | ${ms}ms`);
    return { score, source: 'llm', model, latency_ms: ms };
  } catch (err) {
    console.warn(`[Classifier] Ollama call failed (${err?.message}) — using fallback score ${FALLBACK_SCORE}`);
    console.warn('[Classifier] Make sure Ollama is running: ollama serve');
    return { score: FALLBACK_SCORE, source: 'fallback', reason: err?.message };
  }
}

module.exports = { classifyPrompt, FALLBACK_SCORE };
