#!/usr/bin/env node

/**
 * EcoGate — Initialization CLI  v2.0
 *
 * Steps:
 *   1. Pre-flight: check node / python3 / pip / ollama in $PATH
 *   2. Port prompt
 *   3. Arrow-key multi-select for providers + per-provider key prompt
 *   4. Generate ecogate/server/.env
 *   5. Pull qwen3.5:2b + create ecogate-compressor (animated bar)
 *   6. Set up Python NLP sidecar venv (animated bar)
 *   7. npm install in ecogate/server
 *   8. Spawn sidecar + server, print success banner
 *
 * Usage:  node setup.js          — full interactive setup
 *         node setup.js --check  — pre-flight only (no install / spawn)
 */

'use strict';

const { execSync, spawn, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname);
const SERVER_DIR  = path.join(ROOT, 'ecogate', 'server');
const SIDECAR_DIR = path.join(ROOT, 'ecogate', 'nlp-sidecar');
const ENV_FILE    = path.join(SERVER_DIR, '.env');

// ─── Hardcoded internal constants ─────────────────────────────────────────────
const COMPRESSOR_MODEL = 'ecogate-compressor';
const OLLAMA_BASE_TAG  = 'qwen3.5:2b';
const SIDECAR_PORT     = 8001;

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const R  = '\x1b[0m';
const B  = '\x1b[1m';
const DM = '\x1b[2m';
const GR = '\x1b[32m';
const YL = '\x1b[33m';
const RD = '\x1b[31m';
const CY = '\x1b[36m';
const BL = '\x1b[34m';
const MG = '\x1b[35m';
const UP = (n) => `\x1b[${n}A`;
const EL = '\x1b[2K';  // erase line

const ok   = (m) => console.log(`  ${GR}✔${R}  ${m}`);
const warn = (m) => console.log(`  ${YL}⚠${R}  ${m}`);
const fail = (m) => console.log(`  ${RD}✖${R}  ${B}${m}${R}`);
const info = (m) => console.log(`  ${CY}›${R}  ${m}`);
const step = (m) => console.log(`\n${B}${BL}▶  ${m}${R}`);
const hr   = ()  => console.log(`  ${DM}${'─'.repeat(58)}${R}`);

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
  console.log(`
${B}${GR}  ╔══════════════════════════════════════════════════════╗
  ║        EcoGate  —  Environment Setup  v2.0          ║
  ║   Routing AI inference to the smallest model.       ║
  ╚══════════════════════════════════════════════════════╝${R}
`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

/** Run a command silently (stdout+stderr to /dev/null) — returns exit code */
function shSilent(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'ignore', 'ignore'],
    shell: process.platform === 'win32',
  });
  return res.status ?? 1;
}

/** Run a command silently but collect stderr for error reporting */
function shCapture(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  return { code: res.status ?? 1, stderr: res.stderr || '' };
}

// ─── Animated progress bar ────────────────────────────────────────────────────
class ProgressBar {
  constructor(label, width = 40) {
    this.label  = label;
    this.width  = width;
    this.pct    = 0;
    this.frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    this.fi     = 0;
    this.timer  = null;
    this.done   = false;
    this._print();
  }

  _bar() {
    const filled = Math.round(this.width * this.pct / 100);
    const empty  = this.width - filled;
    return `${GR}${'█'.repeat(filled)}${DM}${'░'.repeat(empty)}${R}`;
  }

  _print() {
    const spin  = this.frames[this.fi % this.frames.length];
    const pctTx = String(Math.round(this.pct)).padStart(3) + '%';
    process.stdout.write(`\r  ${CY}${spin}${R}  ${this.label}  ${this._bar()}  ${DM}${pctTx}${R}`);
  }

  start(intervalMs = 80) {
    this.timer = setInterval(() => {
      if (this.done) return;
      this.fi++;
      // Smoothly advance pct until ~90% (final push happens on finish())
      if (this.pct < 90) this.pct = Math.min(90, this.pct + 0.4);
      this._print();
    }, intervalMs);
  }

  update(pct) {
    this.pct = Math.min(100, pct);
    this._print();
  }

  finish(msg) {
    this.done = true;
    clearInterval(this.timer);
    this.pct = 100;
    process.stdout.write(`\r${EL}  ${GR}✔${R}  ${msg}\n`);
  }

  error(msg) {
    this.done = true;
    clearInterval(this.timer);
    process.stdout.write(`\r${EL}  ${RD}✖${R}  ${msg}\n`);
  }
}

// ─── Arrow-key multi-select ───────────────────────────────────────────────────
const ALL_PROVIDERS = [
  { key: 'OPENAI',    label: 'OpenAI',        envKey: 'OPENAI_API_KEY',    hint: 'sk-...' },
  { key: 'ANTHROPIC', label: 'Anthropic',      envKey: 'ANTHROPIC_API_KEY', hint: 'sk-ant-...' },
  { key: 'GOOGLE',    label: 'Google Gemini',  envKey: 'GOOGLE_API_KEY',    hint: 'AIza...' },
  { key: 'GROQ',      label: 'Groq',           envKey: 'GROQ_API_KEY',      hint: 'gsk_...' },
  { key: 'MISTRAL',   label: 'Mistral AI',     envKey: 'MISTRAL_API_KEY',   hint: '' },
  { key: 'TOGETHER',  label: 'Together AI',    envKey: 'TOGETHER_API_KEY',  hint: '' },
  { key: 'ZAI',       label: 'Z.AI (GLM)',     envKey: 'ZAI_API_KEY',       hint: '' },
];

/**
 * Interactive arrow-key checkbox list.
 * Returns an array of selected provider objects.
 */
function multiSelect(title, items) {
  return new Promise((resolve) => {
    const selected = new Set();
    let cursor = 0;
    let firstRender = true;

    // Total lines printed per render:
    //   1  title line
    //   1  top divider
    //   N  item lines
    //   1  bottom divider
    //   1  count line
    // = N + 4
    const TOTAL_LINES = items.length + 4;

    const w = (s) => process.stdout.write(s);

    const renderList = () => {
      if (!firstRender) {
        // Move up TOTAL_LINES and erase+rewrite each line
        w(`\x1b[${TOTAL_LINES}A`);
      }
      firstRender = false;

      const lines = [
        `  ${B}${MG}${title}${R}  ${DM}(\u2191\u2193 navigate \xB7 Space select \xB7 Enter confirm)${R}`,
        `  ${DM}${'\u2500'.repeat(58)}${R}`,
      ];

      items.forEach((item, i) => {
        const isCursor   = i === cursor;
        const isSelected = selected.has(i);
        const bullet     = isSelected ? `${GR}\u25C9${R}` : `${DM}\u25CB${R}`;
        const label      = isCursor ? `${B}${CY}${item.label}${R}` : item.label;
        const prefix     = isCursor ? `${BL}\u203A${R}` : ' ';
        const arrow      = isCursor ? `  ${DM}\u2190${R}` : '';
        lines.push(`  ${prefix}  ${bullet}  ${label}${arrow}`);
      });

      lines.push(`  ${DM}${'\u2500'.repeat(57)}${R}`);
      lines.push(`  ${DM}${selected.size} provider(s) selected${R}`);

      // \r resets cursor to column 0, \x1b[2K erases the whole line, then write content
      for (const line of lines) {
        w(`\r\x1b[2K${line}\n`);
      }
    };

    renderList();

    const { stdin } = process;
    try { stdin.setRawMode(true); } catch (_) {}
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (key) => {
      if (key === '\u0003' || key === '\u0004') {   // Ctrl-C / Ctrl-D
        try { stdin.setRawMode(false); } catch (_) {}
        stdin.pause();
        stdin.removeListener('data', onData);
        w('\n');
        process.exit(1);
      }

      if      (key === '\u001b[A') cursor = (cursor - 1 + items.length) % items.length; // ↑
      else if (key === '\u001b[B') cursor = (cursor + 1) % items.length;                 // ↓
      else if (key === ' ')  { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); }
      else if (key === 'a' || key === 'A') {
        if (selected.size === items.length) selected.clear();
        else items.forEach((_, i) => selected.add(i));
      } else if (key === '\r' || key === '\n') {
        try { stdin.setRawMode(false); } catch (_) {}
        stdin.pause();
        stdin.removeListener('data', onData);
        w('\n');
        resolve(items.filter((_, i) => selected.has(i)));
        return;
      }

      renderList();
    };

    stdin.on('data', onData);
  });
}

// ─── Simple masked password prompt ────────────────────────────────────────────
function askKey(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const { stdin } = process;
    try { stdin.setRawMode(true); } catch (_) {}
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk) => {
      // Iterate char-by-char so pasted text (arrives as one multi-char chunk) works
      for (const ch of chunk) {
        if (ch === '\u0003' || ch === '\u0004') {
          try { stdin.setRawMode(false); } catch (_) {}
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          process.exit(1);
        } else if (ch === '\r' || ch === '\n') {
          try { stdin.setRawMode(false); } catch (_) {}
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        } else if (ch === '\u007f' || ch === '\b') { // backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

// Visible text prompt implemented in raw mode — no readline buffering side-effects
function askText(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const { stdin } = process;
    try { stdin.setRawMode(true); } catch (_) {}
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\u0003' || ch === '\u0004') {           // Ctrl-C / Ctrl-D
        try { stdin.setRawMode(false); } catch (_) {}
        stdin.pause(); stdin.removeListener('data', onData);
        process.stdout.write('\n'); process.exit(1);
      } else if (ch === '\r' || ch === '\n') {            // Enter
        try { stdin.setRawMode(false); } catch (_) {}
        stdin.pause(); stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value.trim());
      } else if (ch === '\u007f' || ch === '\b') {       // Backspace
        if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (ch.charCodeAt(0) >= 32) {                // Printable
        value += ch; process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

// ─── STEP 1: Pre-flight ───────────────────────────────────────────────────────
function checkDependencies() {
  step('STEP 1 — Pre-flight dependency checks');
  hr();

  const deps = [
    { bins: ['node'],         label: 'Node.js',  flag: '--version' },
    { bins: ['python3'],      label: 'Python 3', flag: '--version' },
    { bins: ['pip3', 'pip'],  label: 'pip',      flag: '--version' },
    { bins: ['ollama'],       label: 'Ollama',   flag: '--version' },
  ];

  const missing = [];
  for (const dep of deps) {
    let found = false, version = '';
    for (const bin of dep.bins) {
      try { version = sh(`${bin} ${dep.flag} 2>&1`).split('\n')[0]; found = true; break; } catch (_) {}
    }
    if (found) ok(`${B}${dep.label}${R} — ${DM}${version}${R}`);
    else { fail(`${dep.label} not found in $PATH`); missing.push(dep); }
  }

  if (missing.length) {
    console.log();
    warn(`Missing: ${missing.map(d => d.label).join(', ')}`);
    const hints = {
      'Node.js':  'https://nodejs.org',
      'Python 3': 'https://www.python.org/downloads/',
      'pip':      'python3 -m ensurepip --upgrade',
      'Ollama':   'https://ollama.com/download',
    };
    for (const dep of missing) info(`${dep.label} → ${hints[dep.label]}`);
    console.log();
    process.exit(1);
  }
  ok('All dependencies satisfied.');
}

// ─── STEP 2 + 3: Port + provider selector ────────────────────────────────────
async function collectConfig() {
  step('STEP 2 — Configuration');
  hr();

  const portRaw = await askText(`  ${B}Proxy Port${R} ${DM}[default: 3000]${R}: `);
  const PORT    = portRaw.trim() || '3000';
  if (!/^\d+$/.test(PORT) || +PORT < 1 || +PORT > 65535) {
    fail(`"${PORT}" is not a valid port number.`); process.exit(1);
  }
  console.log();

  // ── Multi-select provider list ───────────────────────────────────────────
  const selectedProviders = await multiSelect(
    'Select API providers  (press A to toggle all)',
    ALL_PROVIDERS
  );

  console.log();

  if (selectedProviders.length === 0) {
    warn('No providers selected — running in Ollama-only mode.');
    return { PORT, keys: {} };
  }

  // ── Ask for API key per selected provider ─────────────────────────────
  step('STEP 3 — API Keys');
  hr();
  console.log(`  ${DM}Enter the API key for each selected provider. Keys are masked.${R}\n`);

  const keys = {};
  for (const prov of selectedProviders) {
    const hint = prov.hint ? ` ${DM}(e.g. ${prov.hint})${R}` : '';
    const key  = await askKey(`  ${B}${prov.label}${R}${hint}: `);
    if (key) {
      keys[prov.envKey] = key;
      ok(`${prov.label} key saved.`);
    } else {
      warn(`${prov.label} — blank, skipping.`);
    }
  }

  console.log();
  ok(`Port: ${B}${PORT}${R}`);
  const configured = Object.keys(keys).map(k => selectedProviders.find(p => p.envKey === k)?.label).filter(Boolean);
  ok(`Active providers: ${configured.length ? B + configured.join(', ') + R : DM + 'none (Ollama-only)' + R}`);

  return { PORT, keys };
}

// ─── STEP 4: Generate .env ────────────────────────────────────────────────────
function writeEnv({ PORT, keys }) {
  step('STEP 4 — Generating .env');
  hr();

  const ts  = new Date().toISOString();
  const keyLines = ALL_PROVIDERS
    .map(p => `${p.envKey}=${keys[p.envKey] || ''}`)
    .join('\n');

  const env = `# ─── EcoGate Server Configuration ─────────────────────────────────────────────
# Auto-generated by setup.js on ${ts}
# Re-run setup.js to regenerate, or edit this file directly.

# ─── Proxy Port ───────────────────────────────────────────────────────────────
PORT=${PORT}

# ─── Ollama (local inference) ─────────────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434/api

# ─── Prompt Compressor ────────────────────────────────────────────────────────
# HARDCODED — do not change unless you rebuild the Modelfile.
COMPRESSOR_ENABLED=true
COMPRESSOR_URL=http://localhost:11434/api
COMPRESSOR_MODEL=${COMPRESSOR_MODEL}
MIN_PROMPT_TOKENS=150
COMPRESSOR_TIMEOUT_MS=800

# ─── Classifier ───────────────────────────────────────────────────────────────
CLASSIFIER_URL=http://localhost:11434/api
CLASSIFIER_MODEL=${OLLAMA_BASE_TAG}

# ─── NLP Sidecar ─────────────────────────────────────────────────────────────
NLP_SIDECAR_URL=http://localhost:${SIDECAR_PORT}

# ─── Model Router ─────────────────────────────────────────────────────────────
ECOGATE_RESPECT_MODEL=false

# ─── Prompt Cache ─────────────────────────────────────────────────────────────
CACHE_ENABLED=true
CACHE_TTL_MS=3600000
CACHE_SEMANTIC_THRESHOLD=0.95
CACHE_EMBEDDING_MODEL=nomic-embed-text
CACHE_MAX_ENTRIES=5000

# ─── Provider API Keys ────────────────────────────────────────────────────────
${keyLines}

# ─── Carbon Accounting ────────────────────────────────────────────────────────
# NOTE: Carbon figures are ESTIMATES based on published benchmarks, NOT measured.
`;

  fs.writeFileSync(ENV_FILE, env, 'utf8');
  ok(`.env written → ${DM}ecogate/server/.env${R}`);
  info(`Compressor model hardcoded to: ${B}${COMPRESSOR_MODEL}${R}`);
}

// ─── STEP 5: Ollama model pull + Modelfile (with loading bar) ─────────────────
async function setupOllama() {
  step('STEP 5 — Ollama model setup');
  hr();

  const modelfilePath = path.join(ROOT, 'Qwen3-EcoGate.Modelfile');
  const modelfileContent =
`# EcoGate Qwen3 Modelfile — compression-only persona, thinking mode DISABLED
FROM ${OLLAMA_BASE_TAG}

PARAMETER num_ctx 4096
PARAMETER temperature 0.1
# Disable extended chain-of-thought thinking — we need fast, direct output
PARAMETER think false

SYSTEM """
You are EcoGate's prompt compression engine.
Your sole task: rewrite the user's message into the shortest, lossless
version that preserves full semantic content for an AI assistant.

Rules:
- Remove filler words, redundancy, and pleasantries.
- Keep technical tokens, names, numbers, and constraints verbatim.
- Never add commentary, preamble, or explanation.
- Output ONLY the compressed prompt — nothing else.
"""
`;

  fs.writeFileSync(modelfilePath, modelfileContent, 'utf8');
  ok(`Modelfile written → ${DM}Qwen3-EcoGate.Modelfile${R} ${DM}(think=false)${R}`);

  // ── Pull base model ────────────────────────────────────────────────────────
  let alreadyPulled = false;
  try { alreadyPulled = sh('ollama list').includes(OLLAMA_BASE_TAG); } catch (_) {}

  if (alreadyPulled) {
    ok(`Base model ${B}${OLLAMA_BASE_TAG}${R} already present — skipping pull.`);
  } else {
    const bar = new ProgressBar(`Pulling ${B}${OLLAMA_BASE_TAG}${R}  (may take minutes on first run)`, 36);
    bar.start(100);

    // ollama pull writes progress to stdout; capture it line-by-line for pct extraction
    await new Promise((resolve, reject) => {
      const child = spawn('ollama', ['pull', OLLAMA_BASE_TAG], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const parseLine = (line) => {
        // Ollama outputs lines like: "pulling manifest" / "pulling abc123... 45%"
        const m = line.match(/(\d+)%/);
        if (m) bar.update(parseInt(m[1], 10));
      };

      let buf = '';
      const feed = (chunk) => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        lines.forEach(parseLine);
      };

      child.stdout.on('data', (d) => feed(d.toString()));
      child.stderr.on('data', (d) => feed(d.toString()));
      child.on('close', (code) => {
        if (code === 0) { bar.finish(`Base model ${B}${OLLAMA_BASE_TAG}${R} pulled.`); resolve(); }
        else { bar.error(`ollama pull failed (exit ${code})`); reject(new Error(`ollama pull exit ${code}`)); }
      });
      child.on('error', (err) => { bar.error(err.message); reject(err); });
    });
  }

  // ── Register custom model ──────────────────────────────────────────────────
  {
    const bar = new ProgressBar(`Registering ${B}${COMPRESSOR_MODEL}${R}`, 36);
    bar.start(120);
    const { code, stderr } = shCapture('ollama', ['create', COMPRESSOR_MODEL, '-f', modelfilePath], ROOT);
    if (code === 0) {
      bar.finish(`Custom model ${B}${COMPRESSOR_MODEL}${R} registered.`);
    } else {
      bar.error(`Could not register custom model (non-fatal): ${stderr.split('\n')[0]}`);
    }
  }
}

// ─── STEP 6: Python sidecar venv (with loading bar) ──────────────────────────
async function setupSidecar() {
  step('STEP 6 — Python NLP sidecar');
  hr();

  const reqFile   = path.join(SIDECAR_DIR, 'requirements.txt');
  const venvDir   = path.join(SIDECAR_DIR, 'venv');
  const isWin     = process.platform === 'win32';
  const pythonBin = isWin ? path.join(venvDir, 'Scripts', 'python') : path.join(venvDir, 'bin', 'python');
  const pipBin    = isWin ? path.join(venvDir, 'Scripts', 'pip')    : path.join(venvDir, 'bin', 'pip');

  if (!fs.existsSync(reqFile)) {
    fail(`requirements.txt not found at ${reqFile}`); process.exit(1);
  }

  // ── Virtual environment ────────────────────────────────────────────────────
  if (fs.existsSync(venvDir)) {
    ok(`venv exists → ${DM}ecogate/nlp-sidecar/venv${R}`);
  } else {
    const bar = new ProgressBar('Creating Python virtual environment', 36);
    bar.start(150);
    const code = shSilent('python3', ['-m', 'venv', 'venv'], SIDECAR_DIR);
    if (code === 0) bar.finish('Virtual environment created.');
    else { bar.error('Failed to create venv.'); process.exit(1); }
  }

  // ── Upgrade pip ────────────────────────────────────────────────────────────
  {
    const bar = new ProgressBar('Upgrading pip', 36);
    bar.start(120);
    const code = shSilent(pythonBin, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], SIDECAR_DIR);
    if (code === 0) bar.finish('pip upgraded.');
    else bar.error('pip upgrade failed (non-fatal).');
  }

  // ── Install Python deps ────────────────────────────────────────────────────
  {
    info(`Installing Python dependencies ${DM}(first run: ~5 min for torch/llmlingua)${R}`);
    const bar = new ProgressBar('Installing Python packages', 36);
    bar.start(200); // slow spin because this takes minutes

    const { code, stderr } = shCapture(pipBin, ['install', '-r', reqFile], SIDECAR_DIR);
    if (code === 0) {
      bar.finish('Python dependencies installed.');
    } else {
      bar.error(`pip install failed:\n  ${stderr.split('\n').slice(-3).join('\n  ')}`);
      process.exit(1);
    }
  }

  // ── spaCy model ───────────────────────────────────────────────────────────
  {
    const bar = new ProgressBar(`Downloading spaCy model ${B}en_core_web_sm${R}`, 36);
    bar.start(120);
    const code = shSilent(pythonBin, ['-m', 'spacy', 'download', 'en_core_web_sm'], SIDECAR_DIR);
    if (code === 0) bar.finish('spaCy en_core_web_sm ready.');
    else bar.error('spaCy model download failed (non-fatal — sidecar may still work).');
  }
}

// ─── STEP 7: Node server deps ─────────────────────────────────────────────────
async function setupNodeServer() {
  step('STEP 7 — Node.js server');
  hr();

  const nmDir = path.join(SERVER_DIR, 'node_modules');
  if (fs.existsSync(nmDir)) {
    ok('node_modules present — skipping npm install.');
  } else {
    const bar = new ProgressBar('Running npm install', 36);
    bar.start(150);
    const code = shSilent('npm', ['install'], SERVER_DIR);
    if (code === 0) bar.finish('Node.js dependencies installed.');
    else { bar.error('npm install failed.'); process.exit(1); }
  }
}

// ─── STEP 8: Spawn processes ──────────────────────────────────────────────────
function spawnServices(port) {
  step('STEP 8 — Starting services');
  hr();

  const isWin     = process.platform === 'win32';
  const pythonBin = path.join(SIDECAR_DIR, 'venv', isWin ? 'Scripts' : 'bin', 'python');

  // Spawn Python NLP sidecar — suppress uvicorn/HuggingFace output
  const sidecar = spawn(
    pythonBin,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(SIDECAR_PORT), '--log-level', 'error'],
    { cwd: SIDECAR_DIR, stdio: ['ignore', 'ignore', 'pipe'], detached: false }
  );
  sidecar.stderr.on('data', () => {});  // drain stderr silently
  sidecar.on('error', (err) => warn(`Sidecar error: ${err.message}`));
  sidecar.on('close', (code) => { if (code) warn(`Sidecar exited with code ${code}`); });
  ok(`NLP sidecar spawned → ${DM}http://127.0.0.1:${SIDECAR_PORT}${R}`);

  // Give sidecar a moment to bind before starting node
  setTimeout(() => {
    const server = spawn('node', ['index.js'], {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PORT: port },
    });
    server.on('error', (err) => { fail(`Server error: ${err.message}`); process.exit(1); });
    server.on('close', (code) => process.exit(code || 0));
    ok(`EcoGate proxy spawned → ${DM}http://localhost:${port}${R}`);

    setTimeout(() => {
      printSuccessBanner(port);
      startRepl(port);
    }, 1500);
  }, 2000);

  const cleanup = () => { try { sidecar.kill(); } catch (_) {} };
  process.on('SIGINT',  cleanup);
  process.on('SIGTERM', cleanup);
}

function printSuccessBanner(port) {
  console.log(`
${B}${GR}  ╔══════════════════════════════════════════════════════╗
  ║          EcoGate Proxy is live!  🚀                  ║
  ╚══════════════════════════════════════════════════════╝${R}

  ${B}API base URL${R}      →  ${CY}http://localhost:${port}/v1${R}
  ${B}Terminal metrics${R}  →  ${DM}curl http://localhost:${port}/${R}
  ${B}Dashboard UI${R}      →  ${CY}http://localhost:${port}/frontend${R}
  ${B}NLP Sidecar${R}       →  ${DM}http://127.0.0.1:${SIDECAR_PORT}/compress${R}

  ${DM}Update your app's base_url to:${R}
    ${B}http://localhost:${port}/v1${R}

  ${DM}Press Ctrl+C to stop all services.${R}
`);
}

function openFrontend(port) {
  const url = `http://localhost:${port}/frontend`;
  info(`Opening ${url}`);
  try {
    const start = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${start} ${url}`);
  } catch (err) {
    warn('Could not launch browser automatically.');
  }
}

async function addOrChangeKey(actionStr) {
  const selectedProviders = await multiSelect(
    `Select provider to ${actionStr}  (Press Enter to confirm)`,
    ALL_PROVIDERS
  );
  if (selectedProviders.length === 0) {
    warn('Action cancelled.');
    return;
  }
  
  const prov = selectedProviders[0];
  const hint = prov.hint ? ` (e.g. ${prov.hint})` : '';
  const newKey = await askKey(`Enter new key for ${prov.label}${hint}: `);
  
  if (!newKey) {
    warn(`No key entered. Action cancelled.`);
    return;
  }
  
  let envContent = fs.readFileSync(ENV_FILE, 'utf8');
  if (envContent.includes(`${prov.envKey}=`)) {
    // Replace existing key
    envContent = envContent.replace(new RegExp(`${prov.envKey}=.*`, 'g'), `${prov.envKey}=${newKey}`);
  } else {
    // Append
    envContent += `\n${prov.envKey}=${newKey}\n`;
  }
  
  fs.writeFileSync(ENV_FILE, envContent, 'utf8');
  ok(`Updated ${prov.envKey} in .env`);
  warn(`Note: You may need to restart the proxy for changes to take effect.`);
}

async function startRepl(port) {
  // Short delay to let any server output clear
  await new Promise(r => setTimeout(r, 500));
  
  while (true) {
    const cmd = await askText(`\n${CY}ecogate>${R} `);
    switch (cmd.toLowerCase()) {
      case '/frontend':
        openFrontend(port);
        break;
      case '/change-key':
        await addOrChangeKey('change key');
        break;
      case '/add-key':
        await addOrChangeKey('add key');
        break;
      case 'exit':
      case 'quit':
      case '/exit':
      case '/quit':
        process.exit(0);
      default:
        if (cmd) {
          warn(`Unknown command: ${cmd}`);
          info(`Available commands: /frontend, /change-key, /add-key, /exit`);
        }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  banner();

  const checkOnly = process.argv.includes('--check');

  // Guard: interactive prompts require a real TTY
  if (!checkOnly && !process.stdin.isTTY) {
    console.error(`
  ${RD}${B}✖  stdin is not a TTY.${R}

  This script requires an interactive terminal.
  Run it directly in your terminal:

    ${B}node setup.js${R}

  Do NOT pipe or redirect stdin into this script.
`);
    process.exit(1);
  }

  try {
    checkDependencies();

    if (checkOnly) {
      console.log(`\n  ${GR}${B}Pre-flight passed. Run without --check to continue setup.${R}\n`);
      process.exit(0);
    }

    const config = await collectConfig();
    writeEnv(config);
    await setupOllama();
    await setupSidecar();
    await setupNodeServer();
    spawnServices(config.PORT);

  } catch (err) {
    console.log();
    fail(`Unexpected error: ${err.message}`);
    console.log();
    process.exit(1);
  }
})();
