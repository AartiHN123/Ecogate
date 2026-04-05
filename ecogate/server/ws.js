'use strict';

/**
 * EcoGate WebSocket Hub
 *
 * Broadcasts real-time events to all connected dashboard clients.
 *
 * Events pushed to clients (JSON):
 *   { type: 'request_complete', data: <log row + carbon> }
 *   { type: 'stats_update',     data: <getStats() result> }
 *   { type: 'ping' }
 *
 * Usage:
 *   const { createWsHub, broadcast } = require('./ws');
 *   createWsHub(httpServer);          // call once at startup
 *   broadcast('request_complete', row); // call after each request
 */

const { WebSocketServer } = require('ws');

let wss = null;

/**
 * Attach a WebSocket server to an existing HTTP server.
 * @param {import('http').Server} httpServer
 */
function createWsHub(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket, req) => {
    console.log(`[WS] Client connected  (${req.socket.remoteAddress}) — total: ${wss.clients.size}`);

    // Heartbeat ping every 30 s to keep connections alive through proxies
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('close', () => {
      console.log(`[WS] Client disconnected — total: ${wss.clients.size}`);
    });

    socket.on('error', (err) => {
      console.warn('[WS] Socket error:', err.message);
    });

    // Send a welcome ping so client knows the connection is live
    safeSend(socket, { type: 'ping' });
  });

  // Heartbeat interval — drop dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('[WS] WebSocket hub ready at ws://localhost:<PORT>/ws');
  return wss;
}

/**
 * Send a message to one socket safely (no-throw on closed socket).
 */
function safeSend(socket, payload) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch (_) { /* swallow */ }
}

/**
 * Broadcast an event to ALL connected dashboard clients.
 * @param {string} type   event name
 * @param {object} data   payload
 */
function broadcast(type, data) {
  if (!wss || wss.clients.size === 0) return;
  const msg = JSON.stringify({ type, data, ts: new Date().toISOString() });
  wss.clients.forEach((socket) => {
    if (socket.readyState === socket.OPEN) {
      try { socket.send(msg); } catch (_) { /* swallow */ }
    }
  });
}

/**
 * Return count of connected clients (for health endpoint).
 */
function clientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { createWsHub, broadcast, clientCount };
