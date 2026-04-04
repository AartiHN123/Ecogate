'use strict';

/**
 * routes/api.js — Dashboard REST API
 *
 * GET /api/stats  — Aggregate statistics (total requests, carbon saved, tokens, model breakdown)
 * GET /api/logs   — Most recent request logs (default 100, ?limit=N to override)
 * GET /api/daily  — Carbon saved per day for the last 30 days (heatmap data)
 */

const { Router } = require('express');
const db         = require('../db');

const router = Router();

// GET /api/stats
router.get('/stats', (_req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    console.error('[API] /stats error:', err);
    res.status(500).json({ error: 'Failed to retrieve stats.' });
  }
});

// GET /api/logs?limit=100
router.get('/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const logs  = db.getRecentLogs(limit);
    res.json(logs);
  } catch (err) {
    console.error('[API] /logs error:', err);
    res.status(500).json({ error: 'Failed to retrieve logs.' });
  }
});

// GET /api/daily?days=30
router.get('/daily', (req, res) => {
  try {
    const days  = Math.min(parseInt(req.query.days, 10) || 30, 365);
    const daily = db.getDailyStats(days);
    res.json(daily);
  } catch (err) {
    console.error('[API] /daily error:', err);
    res.status(500).json({ error: 'Failed to retrieve daily stats.' });
  }
});

module.exports = router;
