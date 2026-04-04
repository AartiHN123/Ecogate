'use strict';

/**
 * logger.js
 * Lightweight structured request/response logger.
 * Wraps morgan and adds EcoGate-specific fields (model, tokens).
 * In Hour 1–2, this will be extended to write to SQLite.
 */

const morgan = require('morgan');

// Custom morgan token: capture the EcoGate model header from the response
morgan.token('ecogate-model', (req, res) => res.getHeader('X-EcoGate-Model') || '-');
morgan.token('tokens-in',    (req, res) => res.getHeader('X-EcoGate-Tokens-In') || '-');
morgan.token('tokens-out',   (req, res) => res.getHeader('X-EcoGate-Tokens-Out') || '-');

// Format: METHOD URL STATUS ms — model | in→out tokens
const FORMAT =
  ':method :url :status :response-time ms — model::ecogate-model | in::tokens-in out::tokens-out';

const httpLogger = morgan(FORMAT, {
  // Skip health checks so logs don't get noisy
  skip: (req) => req.url === '/health',
});

module.exports = { httpLogger };
