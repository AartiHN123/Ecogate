'use strict';

require('dotenv').config();

const http    = require('http');
const path    = require('path');
const express = require('express');
const { OpenAI } = require('openai');
const { getProvider, getApiKey, listProviders } = require('./providers');
const { logRequest, getLogs, getStats, getTimeseries } = require('./db');
const { startSync, getBuckets } = require('./model-sync');
const { classifyPrompt }  = require('./classifier');
const { routeModel }      = require('./router');
const { calculateCarbon } = require('./carbon');
const { createWsHub, broadcast, clientCount } = require('./ws');
const { compressPrompt }  = require('./compressor');
const { lookupCache, storeCache, getCacheStats } = require('./prompt-cache');


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
app.options(/.*/, (_req, res) => res.sendStatus(204));

// Simple request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'EcoGate Proxy', version: '0.1.0', ws_clients: clientCount() });
});

// ─── GET / — CLI metrics (curl http://localhost:<PORT>/) ──────────────────
// Returns a plain-text ASCII table of the latest EcoGate stats.
// Designed for terminal viewing: curl http://localhost:3000/
app.get('/', (_req, res) => {
  const { totals, models, compression } = getStats();
  const t = totals || {};
  const topModel = (models || [])[0];

  const pad  = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  const fmt4 = (n) => (Number(n) || 0).toFixed(4);
  const fmtN = (n) => (Number(n) || 0).toLocaleString();

  const W = 54;
  const bar  = '═'.repeat(W);
  const dash = '─'.repeat(W);

  const lines = [
    '',
    `  ╔${bar}╗`,
    `  ║${' EcoGate  —  Live Metrics'.padEnd(W)}║`,
    `  ╠${bar}╣`,
    `  ║  ${pad('Metric', 28)}${rpad('Value', W - 30)}  ║`,
    `  ╠${dash}╣`,
    `  ║  ${pad('Total Requests', 28)}${rpad(fmtN(t.total_requests), W - 30)}  ║`,
    `  ║  ${pad('Tokens In', 28)}${rpad(fmtN(t.total_tokens_in), W - 30)}  ║`,
    `  ║  ${pad('Tokens Out', 28)}${rpad(fmtN(t.total_tokens_out), W - 30)}  ║`,
    `  ║  ${pad('Avg Latency (ms)', 28)}${rpad(Math.round(t.avg_latency_ms || 0), W - 30)}  ║`,
    `  ╠${dash}╣`,
    `  ║  ${pad('Carbon Used (g CO₂e)', 28)}${rpad(fmt4(t.total_carbon_g), W - 30)}  ║`,
    `  ║  ${pad('Baseline Carbon (g CO₂e)', 28)}${rpad(fmt4(t.total_baseline_carbon_g), W - 30)}  ║`,
    `  ║  ${pad('Carbon Saved (g CO₂e)', 28)}${rpad(fmt4(t.total_savings_g), W - 30)}  ║`,
    `  ║  ${pad('Savings %', 28)}${rpad((t.savings_pct || 0) + '%', W - 30)}  ║`,
    `  ╠${dash}╣`,
    `  ║  ${pad('Compression Avg Ratio', 28)}${rpad(compression ? (Number(compression.avg_ratio) || 0).toFixed(2) + 'x' : 'n/a', W - 30)}  ║`,
    `  ║  ${pad('Top Model', 28)}${rpad(topModel ? topModel.model : 'n/a', W - 30)}  ║`,
    `  ╠${dash}╣`,
    `  ║  ${pad('Dashboard UI', 28)}${rpad('GET /frontend', W - 30)}  ║`,
    `  ║  ${pad('API Proxy', 28)}${rpad('POST /v1/chat/completions', W - 30)}  ║`,
    `  ╚${bar}╝`,
    '',
  ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(lines.join('\n'));
});

// ─── GET /frontend — Browser dashboard ─────────────────────────────────────
app.get('/frontend', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});


// ─── List available providers ──────────────────────────────────────────────
// GET /v1/providers
// Returns all registered providers and whether they have an API key configured.
//
// Example response:
// [
//   { id: "openai", name: "OpenAI", defaultModel: "gpt-5.4-nano", enabled: true, ... },
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

// ─── GET /api/stats/timeseries ───────────────────────────────────────────────
// Returns carbon/savings/request-count grouped by time bucket.
// Query params:
//   ?period=7d          — lookback window: 1d | 7d | 30d  (default: 7d)
//   ?granularity=day    — bucket size: hour | day         (default: auto)
//
// Example response:
// [
//   { bucket: "2026-04-01", requests: 42, carbon_g: 0.12, savings_g: 0.95, tokens: 18400 },
//   ...
// ]
app.get('/api/stats/timeseries', (req, res) => {
  const period      = ['1d', '7d', '30d'].includes(req.query.period) ? req.query.period : '7d';
  const granularity = ['hour', 'day'].includes(req.query.granularity) ? req.query.granularity : undefined;
  res.json(getTimeseries(period, granularity));
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

  // ── 4. Cache lookup — short-circuit before any API calls ─────────────────
  const cacheResult = await lookupCache(body.messages);
  if (cacheResult.hit) {
    const cacheStats = getCacheStats();
    console.log(`[EcoGate] Cache ${cacheResult.tier.toUpperCase()} HIT (sim=${cacheResult.similarity.toFixed(4)}) — skipping all API calls`);
    logRequest({
      provider:           provider.id,
      model:              cacheResult.model || 'cached',
      tokens_in:          0,
      tokens_out:         0,
      latency_ms:         0,
      complexity_score:   null,
      complexity_source:  'cache',
      routing_tier:       null,
      was_routed:         0,
      carbon_g:           0,
      baseline_carbon_g:  0,
      savings_g:          0,
      cache_hit:          1,
      cache_tier:         cacheResult.tier,
      original_prompt:    JSON.stringify(body.messages),
      compressed_prompt:  null,
      compression_model:  null,
    });
    broadcast('cache_hit', {
      tier:        cacheResult.tier,
      similarity:  cacheResult.similarity,
      total_hits:  cacheStats.total_hits,
      timestamp:   new Date().toISOString(),
    });
    return res.json(cacheResult.response);
  }


  // ── 5. Build OpenAI-SDK client for this provider ─────────────────────────
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.extraHeaders || {},
  });

  // ── 6. Classify prompt complexity & compress prompt ──────────────────────
  const [classification, compression] = await Promise.all([
    classifyPrompt(body.messages),
    compressPrompt(body.messages),
  ]);

  const routing = routeModel(
    classification.score,
    provider.id,
    body.model,           // caller's requested model (may be empty)
    provider.defaultModel // provider fallback
  );

  // Apply routed model + compressed messages
  const requestBody = {
    ...body,
    messages: compression.compressed_messages,
    model:    routing.model,
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

  // ── 7. Forward request ───────────────────────────────────────────────────
  try {
    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Request token usage in the final stream chunk (supported by OpenAI + most compat APIs).
      const streamReq = {
        ...requestBody,
        stream: true,
        stream_options: { include_usage: true },
      };

      const stream = await client.chat.completions.create(streamReq);

      let streamUsage   = null; // populated by the final chunk that carries usage
      let actualModel   = requestBody.model;
      let outputChars   = 0;    // fallback: count chars in delta content

      for await (const chunk of stream) {
        // Some providers send a trailing chunk with usage and no choices
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }
        if (chunk.model) {
          actualModel = chunk.model;
        }
        // Accumulate output chars for fallback token estimation
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) outputChars += delta.length;

        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write('data: [DONE]\n\n');
      res.end();

      const latency = Date.now() - startTime;

      // ── Resolve token counts ─────────────────────────────────────────────
      // Prefer the usage chunk; fall back to a rough char-based estimate.
      const tokens_in  = streamUsage?.prompt_tokens     ?? 0;
      const tokens_out = streamUsage?.completion_tokens ?? Math.ceil(outputChars / 4);

      // ── Carbon + persistence (mirrors non-streaming path) ─────────────────
      const carbon = calculateCarbon({
        model:      actualModel,
        providerId: provider.id,
        tokens_in,
        tokens_out,
      });

      logRequest({
        provider:            provider.id,
        model:               actualModel,
        tokens_in,
        tokens_out,
        latency_ms:          latency,
        complexity_score:    classification.score,
        complexity_source:   classification.source,
        routing_tier:        routing.tier,
        was_routed:          routing.wasRouted ? 1 : 0,
        carbon_g:            carbon.carbon_g,
        baseline_carbon_g:   carbon.baseline_carbon_g,
        savings_g:           carbon.savings_g,
        original_tokens:     compression.original_tokens,
        compressed_tokens:   compression.compressed_tokens,
        compression_ratio:   compression.savings_pct,
        cache_hit:           0,
        cache_tier:          null,
        original_prompt:     JSON.stringify(body.messages),
        compressed_prompt:   JSON.stringify(compression.compressed_messages),
        compression_model:   compression.compression_model,
      });

      // Cache the response (fire-and-forget)
      storeCache(body.messages, { choices: [{ message: { role: 'assistant', content: 'stream' } }] }, provider.id, actualModel).catch(() => {});


      console.log(
        `[EcoGate] ← ${provider.name} (stream) | Model: ${actualModel} | ` +
        `Tokens: ${tokens_in + tokens_out} | ${latency}ms | ` +
        `Carbon: ${carbon.carbon_g.toFixed(4)}g | Saved: ${carbon.savings_g.toFixed(4)}g (${carbon.savings_pct}%)`
      );

      broadcast('request_complete', {
        provider:          provider.id,
        model:             actualModel,
        tokens_in,
        tokens_out,
        latency_ms:        latency,
        complexity_score:  classification.score,
        routing_tier:      routing.tier,
        was_routed:        routing.wasRouted,
        carbon_g:          carbon.carbon_g,
        baseline_carbon_g: carbon.baseline_carbon_g,
        savings_g:         carbon.savings_g,
        savings_pct:       carbon.savings_pct,
        timestamp:         new Date().toISOString(),
        streamed:          true,
        original_prompt:   JSON.stringify(body.messages),
        compressed_prompt: JSON.stringify(compression.compressed_messages),
        compression_model: compression.compression_model,
      });
      broadcast('stats_update', getStats());
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
        original_tokens:     compression.original_tokens,
        compressed_tokens:   compression.compressed_tokens,
        compression_ratio:   compression.savings_pct,
        cache_hit:           0,
        cache_tier:          null,
        original_prompt:     JSON.stringify(body.messages),
        compressed_prompt:   JSON.stringify(compression.compressed_messages),
        compression_model:   compression.compression_model,
      });

      // Cache the response (fire-and-forget)
      storeCache(body.messages, completion, provider.id, completion.model || requestBody.model).catch(() => {});


      console.log(
        `[EcoGate] ← ${provider.name} | Model: ${completion.model} | ` +
        `Tokens: ${completion.usage?.total_tokens ?? '?'} | ${latency}ms | ` +
        `Carbon: ${carbon.carbon_g.toFixed(4)}g | Saved: ${carbon.savings_g.toFixed(4)}g (${carbon.savings_pct}%)`
      );

      // ── Broadcast to dashboard via WebSocket ─────────────────────────────────
      broadcast('request_complete', {
        provider:          provider.id,
        model:             completion.model || requestBody.model,
        tokens_in:         completion.usage?.prompt_tokens     || 0,
        tokens_out:        completion.usage?.completion_tokens || 0,
        latency_ms:        latency,
        complexity_score:  classification.score,
        routing_tier:      routing.tier,
        was_routed:        routing.wasRouted,
        carbon_g:          carbon.carbon_g,
        baseline_carbon_g: carbon.baseline_carbon_g,
        savings_g:         carbon.savings_g,
        savings_pct:       carbon.savings_pct,
        timestamp:         new Date().toISOString(),
        original_prompt:   JSON.stringify(body.messages),
        compressed_prompt: JSON.stringify(compression.compressed_messages),
        compression_model: compression.compression_model,
      });
      broadcast('stats_update', getStats());

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

// Use http.createServer so WebSocket can share the same port
const server = http.createServer(app);
createWsHub(server);

server.listen(PORT, () => {
  console.log(`
  ███████╗ ██████╗ ██████╗  ██████╗  █████╗ ████████╗███████╗
  ██╔════╝██╔════╝██╔═══██╗██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝
  █████╗  ██║     ██║   ██║██║  ███╗███████║   ██║   █████╗  
  ██╔══╝  ██║     ██║   ██║██║   ██║██╔══██║   ██║   ██╔══╝  
  ███████╗╚██████╗╚██████╔╝╚██████╔╝██║  ██║   ██║   ███████╗
  ╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝

  🌿 EcoGate Proxy is live!  🚀
  ✅ API Proxy:        http://localhost:${PORT}/v1
  📊 Terminal metrics: curl http://localhost:${PORT}/
  🖥️  Dashboard UI:   http://localhost:${PORT}/frontend
  🔌 WebSocket:        ws://localhost:${PORT}/ws
  📡 Health:           GET /health

  🔑 Active providers: ${enabledProviders.length ? enabledProviders.join(', ') : 'none — add API keys to .env'}
  `);
});

module.exports = app;
