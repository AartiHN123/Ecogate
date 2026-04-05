'use strict';

/**
 * Restore seeded demo data from backup.
 * Run: node restore-seed-data.js
 *
 * This restores ecogate.db.seed-backup → ecogate.db
 * Use after testing to bring the dashboard demo data back.
 */

const fs   = require('fs');
const path = require('path');

const DB      = path.join(__dirname, 'ecogate.db');
const BACKUP  = path.join(__dirname, 'ecogate.db.seed-backup');
const SHIM    = path.join(__dirname, 'ecogate.db-shm');
const WAL     = path.join(__dirname, 'ecogate.db-wal');

if (!fs.existsSync(BACKUP)) {
  console.error('❌  No backup found at ecogate.db.seed-backup');
  process.exit(1);
}

// Remove WAL files first to avoid journal conflicts
[SHIM, WAL].forEach((f) => { try { fs.unlinkSync(f); } catch {} });

fs.copyFileSync(BACKUP, DB);
console.log('✅  Seed data restored from ecogate.db.seed-backup → ecogate.db');
console.log('    Restart the EcoGate server to pick up the restored data.');
