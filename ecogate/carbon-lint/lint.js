#!/usr/bin/env node
'use strict';

/**
 * carbon-lint/lint.js
 *
 * GitHub Action entrypoint for CarbonLint.
 *
 * Reads the git diff of the current PR, sends it to GPT-4o-mini with a
 * specialized prompt, and posts a PR comment with:
 *   - A Green Score (A–F)
 *   - Specific wasteful patterns detected
 *   - Line-by-line suggestions
 *
 * Triggered automatically on every pull_request event.
 *
 * Usage (in a workflow YAML):
 *   - uses: ./ecogate/carbon-lint
 *     with:
 *       openai_api_key: ${{ secrets.OPENAI_API_KEY }}
 *       github_token:   ${{ secrets.GITHUB_TOKEN }}
 */

const https    = require('https');
const { execSync } = require('child_process');

// ── Read inputs from environment (GitHub Actions sets INPUT_* vars) ───────────
const OPENAI_API_KEY = process.env.INPUT_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const MODEL          = process.env.INPUT_MODEL || 'gpt-4o-mini';
const GITHUB_TOKEN   = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const GITHUB_API     = process.env.GITHUB_API_URL || 'https://api.github.com';
const GITHUB_REPO    = process.env.GITHUB_REPOSITORY; // owner/repo
const PR_NUMBER      = process.env.PR_NUMBER || extractPRNumber();

const SYSTEM_PROMPT = `You are CarbonLint, an AI efficiency auditor.
Analyse the provided git diff for wasteful LLM usage patterns.

Patterns to detect and flag:
1. Calling large models (gpt-4, claude-opus) for simple tasks like formatting, classification, or greeting responses.
2. Making LLM calls inside loops without batching.
3. Not caching repeated identical prompts.
4. Using high max_tokens when the response is expected to be short.
5. Sending full documents when only a summary or excerpt is needed.
6. Missing temperature=0 for deterministic tasks (classification, extraction).
7. Using embeddings or completions endpoints when a cheaper alternative exists.

Output your response as valid JSON with this exact structure:
{
  "score": "A" | "B" | "C" | "D" | "F",
  "score_rationale": "one sentence",
  "issues": [
    {
      "severity": "high" | "medium" | "low",
      "pattern": "short pattern name",
      "description": "what you found and why it wastes carbon",
      "suggestion": "specific fix"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}

If no issues are found, return score "A" and an empty issues array.
Respond ONLY with the JSON object — no markdown fences, no extra text.`;

function extractPRNumber() {
  try {
    const ref = process.env.GITHUB_REF || '';
    const match = ref.match(/refs\/pull\/(\d+)\//);
    return match ? match[1] : null;
  } catch { return null; }
}

async function getDiff() {
  try {
    // In a real CI environment the base ref is available
    const base = process.env.GITHUB_BASE_REF || 'main';
    return execSync(`git diff origin/${base}...HEAD -- '*.js' '*.ts' '*.py' '*.jsx' '*.tsx'`, {
      encoding: 'utf8',
      maxBuffer: 100 * 1024, // 100 KB — cap diff size to keep classifier affordable
    });
  } catch (err) {
    console.error('[CarbonLint] Could not get diff:', err.message);
    return '';
  }
}

function callOpenAI(diff) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Git diff to analyse:\n\n${diff.slice(0, 8000)}` },
      ],
      max_tokens: 800,
      temperature: 0,
    });

    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content || '{}');
        } catch { resolve('{}'); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function postComment(body) {
  if (!GITHUB_TOKEN || !GITHUB_REPO || !PR_NUMBER) {
    console.log('[CarbonLint] (dry run — no GitHub context) Comment would be:\n');
    console.log(body);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const [owner, repo] = GITHUB_REPO.split('/');
    const payload = JSON.stringify({ body });
    const url = new URL(`${GITHUB_API}/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`);

    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent':    'CarbonLint/1.0',
        'Accept':        'application/vnd.github+json',
      },
    };

    const req = https.request(options, res => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function formatComment(result) {
  const scoreEmoji = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '⛔' };
  const emoji = scoreEmoji[result.score] || '❓';

  const issueLines = (result.issues || []).map(i =>
    `\n**${i.severity === 'high' ? '🔴' : i.severity === 'medium' ? '🟠' : '🟡'} ${i.pattern}**\n> ${i.description}\n> 💡 ${i.suggestion}`
  ).join('\n');

  return `## 🌿 CarbonLint — AI Efficiency Report

**Green Score: ${emoji} ${result.score}** — ${result.score_rationale || ''}

${result.summary || ''}
${issueLines || '\n✅ No wasteful LLM patterns detected in this PR.'}

---
*Powered by [EcoGate](https://github.com/your-org/ecogate) — making AI use less planet.*`;
}

async function main() {
  if (!OPENAI_API_KEY) {
    console.error('[CarbonLint] OPENAI_API_KEY is required.');
    process.exit(1);
  }

  console.log('[CarbonLint] Fetching diff…');
  const diff = await getDiff();

  if (!diff.trim()) {
    console.log('[CarbonLint] No relevant code changes found. Skipping.');
    return;
  }

  console.log(`[CarbonLint] Diff size: ${diff.length} chars. Analysing with ${MODEL}…`);
  const raw    = await callOpenAI(diff);
  const result = JSON.parse(raw);

  console.log(`[CarbonLint] Score: ${result.score} | Issues: ${result.issues?.length ?? 0}`);

  const comment = formatComment(result);
  await postComment(comment);
  console.log('[CarbonLint] PR comment posted.');
}

main().catch(err => {
  console.error('[CarbonLint] Fatal error:', err);
  process.exit(1);
});
