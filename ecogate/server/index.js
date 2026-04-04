'use strict';

require('dotenv').config();

const express = require('express');
const { OpenAI } = require('openai');
const { getProvider, getApiKey, listProviders } = require('./providers');
const { logRequest, getLogs, getStats } = require('./db');
const { startSync, getBuckets } = require('./model-sync');
const { classifyPrompt } = require('./classifier');
const { routeModel }     = require('./router');
const { calculateCarbon } = require('./carbon');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Express app ───────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS — allow any origin during hackathon development
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-EcoGate-Provider');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'EcoGate Proxy', version: '0.1.0' });
});

// ─── List available providers ──────────────────────────────────────────────
// GET /v1/providers
// Returns all registered providers and whether they have an API key configured.
//
// Example response:
// [
//   { id: "openai", name: "OpenAI", defaultModel: "gpt-4o-mini", enabled: true, ... },
//   { id: "anthropic", name: "Anthropic", ..., enabled: false },
//   ...
// ]
app.get('/v1/providers', (_req, res) => {
  res.json(listProviders());
});

// ─── GET /api/models ─────────────────────────────────────────────────────
// Returns live bucketed models for all (or one) provider.
// ?provider=openai  to filter to a single provider.
app.get('/api/models', (req, res) => {
  const { provider: pid } = req.query;
  if (pid) {
    return res.json({ [pid]: getBuckets(pid) });
  }
  const all = {};
  for (const p of listProviders()) all[p.id] = getBuckets(p.id);
  res.json(all);
});

// ─── GET /api/logs ────────────────────────────────────────────────────────
// Returns recent requests. Optional ?limit=N (default 100, max 1000).
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
  res.json(getLogs(limit));
});

// ─── GET /api/stats ─────────────────────────────────────────────────────────
// Returns aggregate totals + per-provider/model breakdown.
app.get('/api/stats', (_req, res) => {
  res.json(getStats());
});

// ─── /v1/chat/completions ──────────────────────────────────────────────────
// Drop-in OpenAI-format proxy with multi-provider support.
//
// How to select a provider:
//   Add the header:  X-EcoGate-Provider: anthropic   (defaults to "openai")
//
// How to select a model:
//   Set "model" in the request body as normal.
//   If omitted, the provider's defaultModel is used.
//
// Supported providers: openai | anthropic | google | zai | groq | mistral | together
app.post('/v1/chat/completions', async (req, res) => {
  // ── 1. Resolve provider ──────────────────────────────────────────────────
  const providerId = (req.headers['x-ecogate-provider'] || 'openai').toLowerCase();

  let provider;
  try {
    provider = getProvider(providerId);
  } catch (err) {
    return res.status(err.status || 400).json({
      error: { message: err.message, type: 'invalid_provider' },
    });
  }

  // ── 2. Check API key ─────────────────────────────────────────────────────
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return res.status(503).json({
      error: {
        message: `No API key configured for provider "${provider.name}". Set ${provider.envKey} in your .env file.`,
        type: 'missing_api_key',
        provider: provider.id,
      },
    });
  }

  // ── 3. Validate request body ─────────────────────────────────────────────
  const body = req.body;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({
      error: { message: 'messages array is required and must not be empty', type: 'invalid_request_error' },
    });
  }

  // ── 4. Build OpenAI-SDK client for this provider ─────────────────────────
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.extraHeaders || {},
  });

  // ── 5. Classify prompt complexity & route to optimal model ─────────────────
  const classification = await classifyPrompt(body.messages);
  const routing = routeModel(
    classification.score,
    provider.id,
    body.model,           // caller's requested model (may be empty)
    provider.defaultModel // provider fallback
  );

  // Apply routed model
  const requestBody = {
    ...body,
    model: routing.model,
  };

  const isStreaming = requestBody.stream === true;

  console.log(
    `[EcoGate] Provider: ${provider.name} | ` +
    `Score: ${classification.score} (${routing.tier}) | ` +
    `Model: ${requestBody.model} | ` +
    `Routed: ${routing.wasRouted} | ` +
    `Messages: ${requestBody.messages.length} | Stream: ${isStreaming}`
  );

  const startTime = Date.now();

  // ── 5. Forward request ───────────────────────────────────────────────────
  try {
    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const stream = await client.chat.completions.create({ ...requestBody, stream: true });

      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const completion = await client.chat.completions.create(requestBody);
      const latency = Date.now() - startTime;

      // ── Carbon calculation ───────────────────────────────────────────────
      const carbon = calculateCarbon({
        model:      completion.model || requestBody.model,
        providerId: provider.id,
        tokens_in:  completion.usage?.prompt_tokens     || 0,
        tokens_out: completion.usage?.completion_tokens || 0,
      });

      logRequest({
        provider:            provider.id,
        model:               completion.model || requestBody.model,
        tokens_in:           completion.usage?.prompt_tokens     || 0,
        tokens_out:          completion.usage?.completion_tokens || 0,
        latency_ms:          latency,
        complexity_score:    classification.score,
        complexity_source:   classification.source,
        routing_tier:        routing.tier,
        was_routed:          routing.wasRouted ? 1 : 0,
        carbon_g:            carbon.carbon_g,
        baseline_carbon_g:   carbon.baseline_carbon_g,
        savings_g:           carbon.savings_g,
      });

      console.log(
        `[EcoGate] ← ${provider.name} | Model: ${completion.model} | ` +
        `Tokens: ${completion.usage?.total_tokens ?? '?'} | ${latency}ms | ` +
        `Carbon: ${carbon.carbon_g.toFixed(4)}g | Saved: ${carbon.savings_g.toFixed(4)}g (${carbon.savings_pct}%)`
      );
      res.json(completion);
    }
  } catch (err) {
    console.error(`[EcoGate] ${provider.name} error:`, err?.message ?? err);
    const status = err?.status ?? 500;
    const errorBody = err?.error ?? { message: err?.message ?? 'Internal server error', type: 'proxy_error' };
    res.status(status).json({ error: errorBody, provider: provider.id });
  }
});

// ─── 404 catch-all ─────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { message: 'Not found', type: 'proxy_error' } });
});

// ─── Start ─────────────────────────────────────────────────────────────────
const enabledProviders = listProviders()
  .filter((p) => p.enabled)
  .map((p) => p.name);

// Kick off background model sync (non-blocking)
startSync();

app.listen(PORT, () => {
  console.log(`
  ███████╗ ██████╗ ██████╗  ██████╗  █████╗ ████████╗███████╗
  ██╔════╝██╔════╝██╔═══██╗██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝
  █████╗  ██║     ██║   ██║██║  ███╗███████║   ██║   █████╗  
  ██╔══╝  ██║     ██║   ██║██║   ██║██╔══██║   ██║   ██╔══╝  
  ███████╗╚██████╗╚██████╔╝╚██████╔╝██║  ██║   ██║   ███████╗
  ╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝
  
  🌿 EcoGate Proxy Server  v0.1.0
  ✅ Listening on:    http://localhost:${PORT}
  🔁 POST /v1/chat/completions  (add header: X-EcoGate-Provider: <id>)
  📋 GET  /v1/providers
  📡 GET  /health
  
  🔑 Active providers: ${enabledProviders.length ? enabledProviders.join(', ') : 'none — add API keys to .env'}
  `);
});

module.exports = app;
