'use strict';

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║          EcoGate A/B Comparison Test Runner              ║
 * ║                                                          ║
 * ║  Sends the SAME prompt:                                  ║
 * ║    A) Directly to the LLM provider (baseline)            ║
 * ║    B) Through EcoGate proxy (with compression + routing) ║
 * ║                                                          ║
 * ║  Then prints a side-by-side comparison report.           ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node compare-test.js [--provider=zai|openai|...] [--no-proxy] [--no-direct]
 *
 * Prerequisites:
 *   1. EcoGate server running on PORT 3000 (node index.js)
 *   2. A valid API key in .env for the chosen provider
 */

require('dotenv').config();

const https = require('https');
const http  = require('http');

// ─── Config ────────────────────────────────────────────────────────────────
const ECOGATE_URL  = `http://localhost:${process.env.PORT || 3000}/v1/chat/completions`;
const PORT         = parseInt(process.env.PORT || '3000', 10);

const args        = process.argv.slice(2);
const PROVIDER_ID = (args.find((a) => a.startsWith('--provider=')) || '--provider=zai').split('=')[1];
const RUN_DIRECT  = !args.includes('--no-direct');
const RUN_PROXY   = !args.includes('--no-proxy');

const TEST_PROMPT = `
I would like you to act as a senior web developer and help me with a very important project. I need to build a comprehensive e-commerce product page, but I want to make sure it is completely responsive and accessible. 

First of all, I need a navigation bar at the very top of the page that has links to Home, Products, About Us, and Contact. Make sure it sticks to the top of the window when the user scrolls down.

Below that, I would absolutely love to have a large hero section with a nice placeholder background image, a big bold title saying "Welcome to Our Store", and a call-to-action button that says "Shop Now" which changes color when you hover over it.

Underneath the hero section, please create a grid layout that displays at least six different product cards. Every single product card needs to have a product image placeholder, a title, a short description, a price tag, and an "Add to Cart" button. The grid must be completely responsive, meaning it should show one column on mobile devices, two columns on tablets, and three columns on desktops.

Please make sure you are using HTML5 semantic tags wherever possible. For the styling, please use plain CSS without any frameworks. Write JavaScript so that when a user clicks "Add to Cart", an alert pops up saying "Item added to cart!". 

Could you please provide the completely working code with no omissions or 'TODO' comments? I just want to be able to copy and paste the code and have it work right away. Thank you so much in advance for your help!
`.trim();

// ─── Provider → direct API base URL mapping ─────────────────────────────────
// These MUST match providers.js exactly (same baseURL and defaultModel).
const PROVIDER_ENDPOINTS = {
  zai:       { baseURL: 'https://api.z.ai/api/paas/v4',           envKey: 'ZAI_API_KEY',           defaultModel: 'glm-4.6' },
  openai:    { baseURL: 'https://api.openai.com/v1',              envKey: 'OPENAI_API_KEY',        defaultModel: 'gpt-5.4-nano' },
  anthropic: { baseURL: 'https://api.anthropic.com/v1',           envKey: 'ANTHROPIC_API_KEY',     defaultModel: 'claude-haiku-4-5-20251001' },
  google:    { baseURL: 'https://generativelanguage.googleapis.com/v1beta', envKey: 'GOOGLE_API_KEY',    defaultModel: 'gemini-2.5-flash' },
  groq:      { baseURL: 'https://api.groq.com/openai/v1',         envKey: 'GROQ_API_KEY',          defaultModel: 'llama-3.1-8b-instant' },
  mistral:   { baseURL: 'https://api.mistral.ai/v1',              envKey: 'MISTRAL_API_KEY',       defaultModel: 'ministral-8b-2410' },
  ollama:    { baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',              envKey: 'OLLAMA_BASE_URL',   defaultModel: 'qwen3.5:2b' },
};

// ─── HTTP Helper ────────────────────────────────────────────────────────────
function httpPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(urlStr);
    const mod    = url.protocol === 'https:' ? https : http;
    const data   = JSON.stringify(body);

    const req = mod.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function countApproxTokens(text) {
  // Rough approximation: avg 4 chars per token
  return Math.ceil(text.length / 4);
}

function bar(pct, width = 30) {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function colorize(str, code) {
  return `\x1b[${code}m${str}\x1b[0m`;
}
const green  = (s) => colorize(s, '32');
const yellow = (s) => colorize(s, '33');
const cyan   = (s) => colorize(s, '36');
const bold   = (s) => colorize(s, '1');
const dim    = (s) => colorize(s, '2');
const red    = (s) => colorize(s, '31');

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${bold('╔══════════════════════════════════════════════════════════╗')}`);
  console.log(`${bold('║')}       ${cyan('EcoGate A/B Comparison Test')}                      ${bold('║')}`);
  console.log(`${bold('╚══════════════════════════════════════════════════════════╝')}\n`);

  const providerCfg = PROVIDER_ENDPOINTS[PROVIDER_ID];
  if (!providerCfg) {
    console.error(red(`Unknown provider: "${PROVIDER_ID}". Valid: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`));
    process.exit(1);
  }

  const apiKey = process.env[providerCfg.envKey];
  if (!apiKey) {
    console.error(red(`No API key found for provider "${PROVIDER_ID}". Set ${providerCfg.envKey} in .env`));
    process.exit(1);
  }

  console.log(`${bold('Provider:')}  ${yellow(PROVIDER_ID.toUpperCase())} (${providerCfg.defaultModel})`);
  console.log(`${bold('Prompt:')}    ${dim(TEST_PROMPT.slice(0, 80) + '...')}`);
  console.log(`${bold('Approx tokens in prompt:')} ~${countApproxTokens(TEST_PROMPT)}\n`);
  console.log('─'.repeat(62));

  const messages = [{ role: 'user', content: TEST_PROMPT }];

  // ── Run A: Direct (no EcoGate) ─────────────────────────────────────────
  let directResult = null;
  if (RUN_DIRECT) {
    console.log(`\n${bold('🔵 TEST A — Direct to provider (NO EcoGate proxy)')}\n`);
    const directUrl = `${providerCfg.baseURL}/chat/completions`;
    const t0 = Date.now();
    try {
      const resp = await httpPost(
        directUrl,
        { Authorization: `Bearer ${apiKey}` },
        { model: providerCfg.defaultModel, messages }
      );
      const latency = Date.now() - t0;

      if (resp.status !== 200) {
        console.error(red(`Direct call failed: HTTP ${resp.status}`), resp.body);
      } else {
        const completion = resp.body;
        const tokensIn   = completion.usage?.prompt_tokens     || countApproxTokens(TEST_PROMPT);
        const tokensOut  = completion.usage?.completion_tokens || countApproxTokens(completion.choices?.[0]?.message?.content || '');
        const reply      = completion.choices?.[0]?.message?.content || '';

        directResult = { latency, tokensIn, tokensOut, model: completion.model, reply };

        console.log(`  ${bold('Status:')}     ${green('✅ Success')}`);
        console.log(`  ${bold('Model:')}      ${completion.model}`);
        console.log(`  ${bold('Latency:')}    ${latency}ms`);
        console.log(`  ${bold('Tokens in:')}  ${tokensIn}`);
        console.log(`  ${bold('Tokens out:')} ${tokensOut}`);
        console.log(`  ${bold('Total tokens:')} ${tokensIn + tokensOut}`);
        console.log(`\n  ${dim('Response preview (first 200 chars):')}`);
        console.log(`  ${dim(reply.slice(0, 200).replace(/\n/g, ' '))}...`);
      }
    } catch (err) {
      console.error(red(`Direct call error: ${err.message}`));
    }
  }

  // ── Run B: Through EcoGate proxy ──────────────────────────────────────
  let proxyResult = null;
  if (RUN_PROXY) {
    console.log(`\n${'─'.repeat(62)}`);
    console.log(`\n${bold('🟢 TEST B — Through EcoGate Proxy (with compression + routing)')}\n`);

    // First check if EcoGate is alive
    try {
      const health = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${PORT}/health`, (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => resolve(JSON.parse(raw)));
        }).on('error', reject);
      });
      console.log(`  ${green('✅ EcoGate server is up')} — ${dim(JSON.stringify(health))}`);
    } catch {
      console.error(red(`  ❌ EcoGate proxy is NOT running on port ${PORT}. Start it with: node index.js`));
      console.log(`\n  Skipping proxy test.\n`);
    }

    const t1 = Date.now();
    try {
      const resp = await httpPost(
        ECOGATE_URL,
        {
          Authorization:       `Bearer ${apiKey}`,
          'X-EcoGate-Provider': PROVIDER_ID,
        },
        { model: providerCfg.defaultModel, messages }
      );
      const latency = Date.now() - t1;

      if (resp.status !== 200) {
        console.error(red(`\n  Proxy call failed: HTTP ${resp.status}`), JSON.stringify(resp.body, null, 2));
      } else {
        const completion = resp.body;
        const tokensIn   = completion.usage?.prompt_tokens     || 0;
        const tokensOut  = completion.usage?.completion_tokens || 0;
        const reply      = completion.choices?.[0]?.message?.content || '';

        proxyResult = { latency, tokensIn, tokensOut, model: completion.model, reply };

        console.log(`  ${bold('Status:')}     ${green('✅ Success')}`);
        console.log(`  ${bold('Model:')}      ${completion.model}`);
        console.log(`  ${bold('Latency:')}    ${latency}ms`);
        console.log(`  ${bold('Tokens in:')}  ${tokensIn}`);
        console.log(`  ${bold('Tokens out:')} ${tokensOut}`);
        console.log(`  ${bold('Total tokens:')} ${tokensIn + tokensOut}`);
        console.log(`\n  ${dim('Response preview (first 200 chars):')}`);
        console.log(`  ${dim(reply.slice(0, 200).replace(/\n/g, ' '))}...`);
      }
    } catch (err) {
      console.error(red(`  Proxy call error: ${err.message}`));
    }
  }

  // ── Comparison Report ──────────────────────────────────────────────────
  if (directResult && proxyResult) {
    console.log(`\n${'═'.repeat(62)}`);
    console.log(bold('                📊  COMPARISON REPORT'));
    console.log(`${'═'.repeat(62)}\n`);

    const tokenSavings = directResult.tokensIn - proxyResult.tokensIn;
    const tokenSavingsPct = directResult.tokensIn > 0
      ? Math.round((tokenSavings / directResult.tokensIn) * 100)
      : 0;

    const latencyDiff = proxyResult.latency - directResult.latency;
    const latencyDiffStr = latencyDiff >= 0
      ? red(`+${latencyDiff}ms overhead`)
      : green(`${Math.abs(latencyDiff)}ms faster`);

    // Carbon estimation (rough: 0.0003g CO₂ per token for small models)
    const CARBON_PER_TOKEN = 0.0003;
    const directCarbon  = (directResult.tokensIn + directResult.tokensOut) * CARBON_PER_TOKEN;
    const proxyCarbon   = (proxyResult.tokensIn  + proxyResult.tokensOut)  * CARBON_PER_TOKEN;
    const carbonSaved   = directCarbon - proxyCarbon;

    const W = 18;
    const pad = (s) => String(s).padStart(W);

    console.log(`  ${'Metric'.padEnd(30)} ${'Direct'.padStart(W)} ${'EcoGate'.padStart(W)}`);
    console.log(`  ${'─'.repeat(30)} ${'─'.repeat(W)} ${'─'.repeat(W)}`);
    console.log(`  ${'Tokens In (prompt)'.padEnd(30)} ${pad(directResult.tokensIn)} ${pad(proxyResult.tokensIn)}`);
    console.log(`  ${'Tokens Out (completion)'.padEnd(30)} ${pad(directResult.tokensOut)} ${pad(proxyResult.tokensOut)}`);
    console.log(`  ${'Total Tokens'.padEnd(30)} ${pad(directResult.tokensIn + directResult.tokensOut)} ${pad(proxyResult.tokensIn + proxyResult.tokensOut)}`);
    console.log(`  ${'Latency (ms)'.padEnd(30)} ${pad(directResult.latency)} ${pad(proxyResult.latency)}`);
    console.log(`  ${'Est. Carbon (g CO₂e)'.padEnd(30)} ${pad(directCarbon.toFixed(4))} ${pad(proxyCarbon.toFixed(4))}`);
    console.log(`  ${'─'.repeat(30)} ${'─'.repeat(W)} ${'─'.repeat(W)}`);

    console.log(`\n  ${bold('🔢 Token Savings from Compression:')}`);
    console.log(`     Tokens saved: ${green(tokenSavings + ' tokens')} (${green(tokenSavingsPct + '%')})`);
    console.log(`     ${bar(tokenSavingsPct)} ${tokenSavingsPct}%`);

    console.log(`\n  ${bold('⚡ Latency Overhead:')}`);
    console.log(`     ${latencyDiffStr} (compression + routing adds processing time)`);

    console.log(`\n  ${bold('🌿 Carbon Impact:')}`);
    if (carbonSaved > 0) {
      console.log(`     ${green('Carbon saved: ' + carbonSaved.toFixed(5) + 'g CO₂e')} via token reduction`);
    } else {
      console.log(`     ${yellow('No carbon saved')} — proxy response used more tokens`);
    }

    console.log(`\n  ${bold('🗺  Routing:')}`);
    console.log(`     Direct model:  ${directResult.model}`);
    console.log(`     EcoGate model: ${proxyResult.model} ${proxyResult.model !== directResult.model ? yellow('(routed to different tier!)') : dim('(same)')}`);

    console.log(`\n${bold('  ✅ Check dashboard for full metrics → http://localhost:' + PORT + '/frontend')}\n`);
    console.log(`${'═'.repeat(62)}\n`);

    // ── Write results to JSON for further analysis ─────────────────────
    const resultPath = require('path').join(__dirname, 'test-results.json');
    const results = {
      timestamp:       new Date().toISOString(),
      provider:        PROVIDER_ID,
      prompt_tokens_approx: countApproxTokens(TEST_PROMPT),
      direct: {
        latency_ms:   directResult.latency,
        tokens_in:    directResult.tokensIn,
        tokens_out:   directResult.tokensOut,
        model:        directResult.model,
        carbon_g_est: parseFloat(directCarbon.toFixed(6)),
      },
      ecogate: {
        latency_ms:   proxyResult.latency,
        tokens_in:    proxyResult.tokensIn,
        tokens_out:   proxyResult.tokensOut,
        model:        proxyResult.model,
        carbon_g_est: parseFloat(proxyCarbon.toFixed(6)),
      },
      savings: {
        tokens_saved:    tokenSavings,
        tokens_saved_pct: tokenSavingsPct,
        carbon_saved_g:  parseFloat(carbonSaved.toFixed(6)),
        latency_delta_ms: latencyDiff,
      },
    };
    require('fs').writeFileSync(resultPath, JSON.stringify(results, null, 2));
    console.log(`  ${dim('Full results written to: test-results.json')}\n`);
  }
}

main().catch((err) => {
  console.error(red('Fatal error:'), err);
  process.exit(1);
});
