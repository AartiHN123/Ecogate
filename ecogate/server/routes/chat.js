'use strict';

/**
 * routes/chat.js
 *
 * POST /v1/chat/completions
 *
 * Full EcoGate pipeline:
 *   1. Classify prompt complexity (1–5) via GPT-4o-mini
 *   2. Select the optimal model using the routing table
 *   3. Forward the request to OpenAI (streaming or JSON)
 *   4. Calculate carbon emissions & savings
 *   5. Persist the log entry to SQLite
 *   6. Return the response with EcoGate metadata headers
 *
 * Custom response headers:
 *   X-EcoGate-Model        — model that handled the request
 *   X-EcoGate-Tier         — small | medium | large
 *   X-EcoGate-Tokens-In    — prompt token count
 *   X-EcoGate-Tokens-Out   — completion token count
 *   X-EcoGate-Carbon-G     — gCO2 emitted
 *   X-EcoGate-Saved-G      — gCO2 saved vs always using the large model
 *   X-EcoGate-Complexity   — classifier score 1–5
 */

const { Router } = require('express');
const OpenAI     = require('openai');
const config     = require('../config');
const { classify }     = require('../classifier');
const { selectModel, inferProvider } = require('../router');
const { calculate }    = require('../carbon');
const db               = require('../db');

const router = Router();

// Single OpenAI client — reused across requests
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// ─── POST /v1/chat/completions ────────────────────────────────────────────────
router.post('/chat/completions', async (req, res) => {
  const startTime = Date.now();
  const body      = { ...req.body };

  // Infer provider from the requested model (if specified)
  const requestedProvider = inferProvider(body.model || '');
  const isStreaming       = body.stream === true;

  try {
    // ── Step 1: Classify complexity ───────────────────────────────────────────
    const complexity = await classify(body.messages || []);

    // ── Step 2: Route to the optimal model ───────────────────────────────────
    const { model, tier, provider } = selectModel(complexity, requestedProvider);
    body.model = model; // Swap model in the forwarded request

    if (isStreaming) {
      // ── Streaming path ─────────────────────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-EcoGate-Model',      model);
      res.setHeader('X-EcoGate-Tier',       tier);
      res.setHeader('X-EcoGate-Complexity', complexity);

      const stream = await openai.chat.completions.create({ ...body, stream: true });

      let tokensIn  = 0;
      let tokensOut = 0;

      for await (const chunk of stream) {
        if (chunk.usage) {
          tokensIn  = chunk.usage.prompt_tokens     || tokensIn;
          tokensOut = chunk.usage.completion_tokens || tokensOut;
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();

      // ── Steps 4 & 5 (post-stream) ─────────────────────────────────────────
      const latency = Date.now() - startTime;
      const carbon  = calculate({ model, tokensIn, tokensOut, provider });

      db.insertRequest({
        model,
        tier,
        provider,
        tokens_in:    tokensIn,
        tokens_out:   tokensOut,
        total_tokens: carbon.total_tokens,
        carbon_g:     carbon.carbon_g,
        baseline_g:   carbon.baseline_g,
        saved_g:      carbon.saved_g,
        latency_ms:   latency,
        complexity,
      });

      console.log(
        `[EcoGate] stream done | model=${model} tier=${tier} ` +
        `in=${tokensIn} out=${tokensOut} ` +
        `carbon=${carbon.carbon_g}g saved=${carbon.saved_g}g`
      );

    } else {
      // ── Non-streaming path ─────────────────────────────────────────────────
      const completion = await openai.chat.completions.create(body);

      const tokensIn  = completion.usage?.prompt_tokens     ?? 0;
      const tokensOut = completion.usage?.completion_tokens ?? 0;
      const modelUsed = completion.model ?? model;
      const latency   = Date.now() - startTime;

      const carbon = calculate({ model: modelUsed, tokensIn, tokensOut, provider });

      // ── Step 5: Persist ───────────────────────────────────────────────────
      db.insertRequest({
        model:        modelUsed,
        tier,
        provider,
        tokens_in:    tokensIn,
        tokens_out:   tokensOut,
        total_tokens: carbon.total_tokens,
        carbon_g:     carbon.carbon_g,
        baseline_g:   carbon.baseline_g,
        saved_g:      carbon.saved_g,
        latency_ms:   latency,
        complexity,
      });

      // ── EcoGate metadata headers ──────────────────────────────────────────
      res.setHeader('X-EcoGate-Model',      modelUsed);
      res.setHeader('X-EcoGate-Tier',       tier);
      res.setHeader('X-EcoGate-Tokens-In',  tokensIn);
      res.setHeader('X-EcoGate-Tokens-Out', tokensOut);
      res.setHeader('X-EcoGate-Carbon-G',   carbon.carbon_g);
      res.setHeader('X-EcoGate-Saved-G',    carbon.saved_g);
      res.setHeader('X-EcoGate-Complexity', complexity);

      console.log(
        `[EcoGate] done | model=${modelUsed} tier=${tier} complexity=${complexity} ` +
        `in=${tokensIn} out=${tokensOut} latency=${latency}ms ` +
        `carbon=${carbon.carbon_g}g saved=${carbon.saved_g}g`
      );

      return res.json(completion);
    }

  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      return res.status(err.status || 500).json({
        error: {
          message: err.message,
          type:    err.type  ?? 'api_error',
          code:    err.code  ?? null,
          param:   err.param ?? null,
        },
      });
    }

    console.error('[EcoGate] Unexpected proxy error:', err);
    return res.status(502).json({
      error: {
        message: 'EcoGate proxy encountered an unexpected error. Please try again.',
        type:    'proxy_error',
        code:    'bad_gateway',
      },
    });
  }
});

module.exports = router;
