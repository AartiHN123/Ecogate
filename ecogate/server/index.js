'use strict';

/**
 * index.js — EcoGate Proxy Server
 *
 * Start with:  npm run dev   (development, auto-restart)
 *              npm start     (production)
 *
 * Drop-in OpenAI replacement: set OPENAI_BASE_URL=http://localhost:3000/v1
 * in any app that uses the OpenAI SDK — zero other changes needed.
 */

// ── Config must load first so missing env vars kill the process immediately ──
const config = require('./config');

const express = require('express');
const cors    = require('cors');
const { httpLogger } = require('./middleware/logger');
const db = require('./db');

// Route handlers
const chatRouter = require('./routes/chat');
const apiRouter  = require('./routes/api');

// ── Initialise SQLite database ───────────────────────────────────────────────
db.init();

const app = express();

// ─── Global Middleware ────────────────────────────────────────────────────────
app.use(cors());                   // Allow cross-origin requests (React dashboard)
app.use(express.json());           // Parse JSON request bodies
app.use(httpLogger);               // Structured HTTP logging via morgan

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check — used by Docker and load balancers
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OpenAI-compatible API surface — mounted at /v1 to match OpenAI's base URL
app.use('/v1', chatRouter);

// Dashboard REST API
app.use('/api', apiRouter);

// Catch-all for unrecognised routes
app.use((_req, res) => {
  res.status(404).json({
    error: {
      message: 'The requested endpoint does not exist on this EcoGate proxy.',
      type:    'invalid_request_error',
      code:    'not_found',
    },
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
// Must have exactly 4 params for Express to treat it as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[EcoGate] Unhandled error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'An unexpected error occurred.',
      type:    'server_error',
      code:    'internal_server_error',
    },
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(config.PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║          🌿  EcoGate Proxy Server            ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  ► Listening on  http://localhost:${config.PORT}`);
  console.log(`  ► Environment   ${config.NODE_ENV}`);
  console.log('');
  console.log('  Drop-in OpenAI replacement:');
  console.log(`  Set OPENAI_BASE_URL=http://localhost:${config.PORT}/v1`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`  GET  http://localhost:${config.PORT}/health`);
  console.log(`  POST http://localhost:${config.PORT}/v1/chat/completions`);
  console.log(`  GET  http://localhost:${config.PORT}/api/stats`);
  console.log(`  GET  http://localhost:${config.PORT}/api/logs`);
  console.log(`  GET  http://localhost:${config.PORT}/api/daily`);
  console.log('');
});

module.exports = app; // Export for testing
