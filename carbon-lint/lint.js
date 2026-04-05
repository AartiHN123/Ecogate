'use strict';

/**
 * CarbonLint — EcoGate GitHub Action
 *
 * Analyzes a PR's git diff for wasteful LLM usage patterns using GPT-4o-mini.
 * Posts a PR comment with:
 *   • A Green Score (A–F)
 *   • Line-by-line issues with suggestions
 *   • Overall summary
 *
 * Patterns detected:
 *   1. Calling large models (gpt-4, opus, etc.) for simple tasks
 *   2. LLM calls inside loops without batching
 *   3. Not caching repeated identical prompts
 *   4. Excessive max_tokens for short expected responses
 *   5. Sending full documents when only a summary is needed
 *
 * Environment variables (injected by action.yml):
 *   OPENAI_API_KEY, INPUT_MODEL, INPUT_MAX_DIFF_CHARS, INPUT_GITHUB_TOKEN,
 *   GITHUB_REPOSITORY, GITHUB_EVENT_PATH
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInput(name) {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] || '';
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}\n`);
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

/** Minimal HTTPS POST that returns the parsed JSON body. */
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`Failed to parse response: ${raw}`)); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** GitHub REST API — create or update a PR comment. */
async function postPrComment(token, repo, prNumber, body) {
  const [owner, repoName] = repo.split('/');
  return httpsPost(
    'api.github.com',
    `/repos/${owner}/${repoName}/issues/${prNumber}/comments`,
    {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent':    'EcoGate-CarbonLint/1.0',
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    { body }
  );
}

// ─── LLM Analysis ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are CarbonLint, a code reviewer that identifies wasteful LLM usage patterns to reduce AI carbon emissions.

Analyze the provided git diff and look ONLY for these specific patterns:

1. **LARGE_MODEL_OVERKILL** — Using gpt-4, gpt-4-turbo, claude-opus, gemini-pro, or any "large" model for tasks a small model (gpt-4o-mini, haiku, flash) could handle (e.g. classification, formatting, greeting detection, simple Q&A).

2. **LOOP_WITHOUT_BATCH** — LLM API calls (openai.chat.completions.create, anthropic.messages.create, etc.) inside a for/while/forEach loop without batching. Each iteration makes a separate API call.

3. **NO_PROMPT_CACHE** — Identical or near-identical prompts constructed and sent without any caching mechanism. Look for prompt construction inside loops or functions called repeatedly with the same template.

4. **EXCESSIVE_MAX_TOKENS** — max_tokens set very high (>500) when the expected response is short (classification, yes/no, single word, score rating, etc.).

5. **FULL_DOC_WHEN_SUMMARY_NEEDED** — Sending an entire document, file, or large variable when only a summary or specific fields are needed.

For each issue found, output a JSON object with EXACTLY this structure:
{
  "issues": [
    {
      "pattern": "LARGE_MODEL_OVERKILL",
      "line": 42,
      "severity": "high|medium|low",
      "description": "Using gpt-4 to classify sentiment — gpt-4o-mini achieves 95% the accuracy at 10% the cost and carbon.",
      "suggestion": "Replace model: 'gpt-4' with model: 'gpt-4o-mini' for this classification task."
    }
  ],
  "green_score": "B",
  "summary": "2 issues found: 1 high severity model overkill, 1 medium severity loop batching issue."
}

Green Score rubric:
  A — 0 issues
  B — 1–2 low/medium issues
  C — 1–2 high issues OR 3+ medium issues
  D — 3+ high issues
  F — Critical: LLM calls in tight loops OR entire codebase uses only large models

If no issues are found, return: { "issues": [], "green_score": "A", "summary": "No wasteful LLM patterns detected. Great job! 🌿" }

IMPORTANT: Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

async function analyzeDiff(apiKey, model, diff) {
  const response = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Analyze this git diff:\n\n${diff}` },
      ],
      max_tokens:  1500,
      temperature: 0,
      response_format: { type: 'json_object' },
    }
  );

  if (response.error) {
    throw new Error(`OpenAI API error: ${response.error.message}`);
  }

  const raw = response.choices?.[0]?.message?.content || '{}';
  return JSON.parse(raw);
}

// ─── PR Comment Formatter ─────────────────────────────────────────────────────

const SCORE_EMOJI = { A: '🟢', B: '🟡', C: '🟠', D: '🔴', F: '⛔' };
const SEVERITY_EMOJI = { high: '🔴', medium: '🟠', low: '🟡' };
const PATTERN_LABELS = {
  LARGE_MODEL_OVERKILL:   'Large Model Overkill',
  LOOP_WITHOUT_BATCH:     'LLM Call in Loop (No Batching)',
  NO_PROMPT_CACHE:        'Missing Prompt Cache',
  EXCESSIVE_MAX_TOKENS:   'Excessive max_tokens',
  FULL_DOC_WHEN_SUMMARY_NEEDED: 'Full Document Sent Unnecessarily',
};

function formatComment(result, model) {
  const score  = result.green_score || 'F';
  const emoji  = SCORE_EMOJI[score] || '❓';
  const issues = result.issues || [];

  let md = `## ${emoji} CarbonLint — Green Score: **${score}**\n\n`;
  md += `> *Powered by EcoGate · Analyzed with \`${model}\` · ${issues.length} issue(s) found*\n\n`;
  md += `**${result.summary || 'Analysis complete.'}**\n\n`;

  if (issues.length > 0) {
    md += `---\n\n### Issues Found\n\n`;

    for (const issue of issues) {
      const sev   = SEVERITY_EMOJI[issue.severity] || '⚪';
      const label = PATTERN_LABELS[issue.pattern]  || issue.pattern;
      md += `#### ${sev} \`${label}\`${issue.line ? ` · line ${issue.line}` : ''}\n\n`;
      md += `**Problem:** ${issue.description}\n\n`;
      md += `**Fix:** ${issue.suggestion}\n\n`;
    }
  } else {
    md += `---\n\n### ✅ No wasteful LLM patterns detected\n\n`;
    md += `Your AI code is already carbon-efficient. Keep it up! 🌿\n\n`;
  }

  md += `---\n`;
  md += `<details><summary>ℹ️ What is CarbonLint?</summary>\n\n`;
  md += `CarbonLint is part of [EcoGate](https://github.com/AartiHN123/Ecogate) — the carbon diet for AI inference. `;
  md += `It automatically reviews PRs for LLM usage patterns that waste energy and increase CO₂ emissions.\n\n`;
  md += `**Patterns checked:** Large model overkill · LLM calls in loops · Missing prompt caches · Excessive max_tokens · Full-doc when summary needed\n`;
  md += `</details>\n`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  const apiKey       = getInput('openai_api_key') || process.env.OPENAI_API_KEY;
  const model        = getInput('model')          || 'gpt-4o-mini';
  const githubToken  = getInput('github_token')   || process.env.GITHUB_TOKEN;
  const maxDiffChars = parseInt(getInput('max_diff_chars') || '12000', 10);
  const repo         = process.env.GITHUB_REPOSITORY;
  const eventPath    = process.env.GITHUB_EVENT_PATH;

  if (!apiKey)      fail('Missing openai_api_key input or OPENAI_API_KEY env var.');
  if (!githubToken) fail('Missing github_token input.');
  if (!repo)        fail('GITHUB_REPOSITORY env var not set. Is this running in a GitHub Action?');

  // ── Read PR event to get the PR number ──────────────────────────────────────
  let prNumber;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    prNumber = event.pull_request?.number || event.number;
  } catch (e) {
    fail(`Could not read GitHub event file at ${eventPath}: ${e.message}`);
  }
  if (!prNumber) fail('Could not determine PR number from GitHub event payload.');

  // ── Get the diff ─────────────────────────────────────────────────────────────
  // In a GitHub Action the diff is available via the git command
  // (the action.yml workflow must do: git fetch origin ... && git diff ...)
  // We read it from an env var CARBONLINT_DIFF or fall back to a temp file.
  let diff = process.env.CARBONLINT_DIFF || '';
  if (!diff) {
    const diffFile = path.join(process.env.RUNNER_TEMP || '/tmp', 'pr.diff');
    if (fs.existsSync(diffFile)) {
      diff = fs.readFileSync(diffFile, 'utf8');
    }
  }

  if (!diff.trim()) {
    console.log('[CarbonLint] No diff content found — nothing to analyze.');
    setOutput('green_score', 'A');
    setOutput('issues_found', '0');
    return;
  }

  // Truncate to avoid token limits
  if (diff.length > maxDiffChars) {
    diff = diff.slice(0, maxDiffChars) + '\n\n... [diff truncated for analysis]';
    console.log(`[CarbonLint] Diff truncated to ${maxDiffChars} chars.`);
  }

  // ── Analyze ──────────────────────────────────────────────────────────────────
  console.log(`[CarbonLint] Analyzing diff with ${model}...`);
  let result;
  try {
    result = await analyzeDiff(apiKey, model, diff);
  } catch (e) {
    fail(`LLM analysis failed: ${e.message}`);
  }

  console.log(`[CarbonLint] Green Score: ${result.green_score} | Issues: ${(result.issues || []).length}`);

  // ── Post PR comment ──────────────────────────────────────────────────────────
  const comment = formatComment(result, model);
  try {
    await postPrComment(githubToken, repo, prNumber, comment);
    console.log('[CarbonLint] PR comment posted successfully.');
  } catch (e) {
    // Don't fail the action if the comment can't be posted — analysis is still useful
    console.warn(`[CarbonLint] Warning: Could not post PR comment: ${e.message}`);
  }

  // ── Outputs ──────────────────────────────────────────────────────────────────
  setOutput('green_score', result.green_score || 'F');
  setOutput('issues_found', String((result.issues || []).length));
}

main().catch((err) => {
  console.error('[CarbonLint] Fatal error:', err.message);
  process.exit(1);
});
