'use strict';

/**
 * classifier.js — Complexity Scorer
 *
 * Sends the user's prompt to GPT-4o-mini with a tightly-scoped system prompt
 * and returns an integer score 1–5 representing query complexity.
 *
 * Score bands:
 *   1–2  → small model  (greeting, simple lookup, basic formatting)
 *   3    → medium model (summarisation, moderate reasoning)
 *   4–5  → large model  (expert analysis, multi-step reasoning, creative writing)
 *
 * The classifier itself always uses GPT-4o-mini (cheap + fast).
 * Target latency: < 500 ms so it doesn't noticeably slow the proxy.
 */

const OpenAI = require('openai');
const config = require('./config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a complexity scorer for AI prompts.
Given a user prompt, rate its complexity from 1 to 5.

Score 1 = simple factual lookup, greeting, or yes/no question.
Score 2 = basic Q&A, simple formatting, or single-step instruction.
Score 3 = moderate reasoning, summarisation, translation, or multi-step but routine task.
Score 4 = complex analysis, code generation, multi-step reasoning, or nuanced explanation.
Score 5 = advanced research, expert-level analysis, long creative writing, or complex coding.

Respond with ONLY a single digit (1, 2, 3, 4, or 5). No explanation.`;

/**
 * Classify the complexity of a chat messages array.
 *
 * @param {Array<{role: string, content: string}>} messages - The messages array from the request body.
 * @returns {Promise<number>} - Integer 1–5. Returns 3 (medium) on any error.
 */
async function classify(messages) {
  // Extract the last user message for scoring (most representative of complexity)
  const userContent = messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
    .slice(0, 2000); // Cap at 2000 chars to keep classifier fast & cheap

  if (!userContent) {
    console.warn('[Classifier] No user message found; defaulting to score 3.');
    return 3;
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      max_tokens: 1,
      temperature: 0,
    });

    const raw = response.choices?.[0]?.message?.content?.trim();
    const score = parseInt(raw, 10);

    if (score >= 1 && score <= 5) {
      console.log(`[Classifier] score=${score} for prompt="${userContent.slice(0, 60)}..."`);
      return score;
    }

    console.warn(`[Classifier] Unexpected response "${raw}"; defaulting to 3.`);
    return 3;

  } catch (err) {
    console.error('[Classifier] Error during classification:', err.message);
    return 3; // Safe fallback: medium model
  }
}

module.exports = { classify };
