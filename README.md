# 🌿 EcoGate — The Carbon Diet for AI Inference

> **Hackathon project · Sustainability Challenge · 2-person team**
> *"We're not asking people to use less AI. We're making AI use less planet."*

EcoGate is an AI inference proxy that sits between your application and any LLM API (OpenAI, Anthropic, Google, and more). It does three things automatically:

1. **Compresses Prompts** — reduces tokens via an NLP sidecar before it ever hits the LLM.
2. **Caches Responses** — saves duplicate requests to skip the LLM compute entirely!
3. **Routes requests to the smallest capable model** — 80-90% of queries don't need giant models.
4. **Tracks carbon emissions per request** — every API call is tagged with estimated gCO₂ savings.
5. **Shows you the impact** — a real-time React dashboard with carbon saved, tokens squished, and trees planted.

**Drop-in replacement.** Change one environment variable in your app. Zero code changes needed.

---

## Architecture

```
Your App
   │  OPENAI_BASE_URL=http://localhost:3000/v1
   ▼
┌──────────────────────────────────────────────┐
│              EcoGate Node Proxy              │
│                                              │
│  1. Check Semantic Prompt Cache              │
│  2. Compress Prompt via Python NLP Sidecar   │
│  3. Classify complexity (e.g. gpt-4o-mini)   │
│  4. Route to optimal model tier              │
│  5. Forward compressed request to provider   │
│  6. Calculate tokens & log carbon saved      │
│  7. Broadcast to Live React Dashboard        │
└──────────────────────────────────────────────┘
   │
   ├── Python NLP Sidecar (Stop-words, LLMLingua)
   ├── OpenAI  (gpt-4o-mini / gpt-4o / gpt-4-turbo)
   ├── Anthropic (haiku / sonnet / opus)
   ├── Google  (gemini-flash / gemini-pro)
   ├── Groq, Mistral, Together AI, Z.AI
   └── SQLite → Dashboard → Real-time charts
```

### Model Routing

| Complexity Score | Tier   | OpenAI Route  | Anthropic Route     | Carbon Saving |
|-----------------|--------|---------------|---------------------|---------------|
| 1–2 (simple)    | small  | gpt-4o-mini   | claude-3-haiku      | ~90%          |
| 3 (medium)      | medium | gpt-4o        | claude-3.5-sonnet   | ~60%          |
| 4–5 (complex)   | large  | gpt-4-turbo   | claude-3-opus       | baseline      |

---

## Quick Start

### The Magic One-Liner Install

Get the Python Sidecar, Node Proxy, Ollama integration, and React Dashboard up and running flawlessly in one command:

```bash
curl -sL https://raw.githubusercontent.com/AartiHN123/Ecogate/main/install.sh | bash
```

---

### Manual Setup (If you prefer terminal wizardry)

#### Prerequisites

- Node.js 20+
- Python 3.10+ (for NLP Sidecar)
- API key for at least one provider (OpenAI, Anthropic, Google, Z.AI, etc.)

#### 1. Clone & install

```bash
git clone https://github.com/AartiHN123/Ecogate
cd Ecogate/ecogate/server
npm install
cd ../dashboard
npm install
cd ../nlp-sidecar
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and add your API keys
```

Minimum required — add at least one:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

### 3. Start the proxy

```bash
node index.js
```

You should see:

```
🌿 EcoGate Proxy Server  v0.1.0
✅ Listening on:    http://localhost:3000
🔌 WebSocket at:   ws://localhost:3000/ws
🔑 Active providers: OpenAI, Anthropic
```

### 4. Point your app at EcoGate

Change **one line** in your app's config:

```diff
- OPENAI_BASE_URL=https://api.openai.com/v1
+ OPENAI_BASE_URL=http://localhost:3000/v1
```

That's it. Your app now routes through EcoGate automatically.

---

## Docker (full stack)

```bash
# From the project root
cp ecogate/server/.env.example .env
# Edit .env with your API keys

docker compose up
```

- Proxy: `http://localhost:3000`
- WebSocket: `ws://localhost:3000/ws`

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | Drop-in OpenAI proxy endpoint |
| `GET`  | `/v1/providers` | List all providers + enabled status |
| `GET`  | `/api/models?provider=openai` | Live-bucketed models per provider |
| `GET`  | `/api/stats` | Aggregate totals + per-provider breakdown |
| `GET`  | `/api/stats/timeseries?period=7d` | Carbon savings over time (for charts) |
| `GET`  | `/api/logs?limit=100` | Recent request log |
| `GET`  | `/health` | Health check + WebSocket client count |

### Provider selection

Add the `X-EcoGate-Provider` header to route to a specific provider:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-EcoGate-Provider: anthropic" \
  -d '{"messages": [{"role":"user","content":"Hello!"}]}'
```

### Timeseries API

```
GET /api/stats/timeseries?period=7d&granularity=day
```

| Param | Values | Default |
|-------|--------|---------|
| `period` | `1d` \| `7d` \| `30d` | `7d` |
| `granularity` | `hour` \| `day` | auto (hour for 1d, day otherwise) |

Example response:

```json
[
  { "bucket": "2026-04-01", "requests": 142, "carbon_g": 0.42, "savings_g": 3.81, "tokens": 58200 },
  { "bucket": "2026-04-02", "requests": 287, "carbon_g": 0.71, "savings_g": 7.14, "tokens": 112400 }
]
```

---

## Seeding Demo Data

Generate 1,000 realistic requests for a populated dashboard:

```bash
node seed.js            # insert 1000 rows
node seed.js --count=500 --clear   # wipe + insert 500 rows
```

---

## A/B Comparison Benchmarking

Want to prove EcoGate's efficiency to your team? We include an A/B benchmark script that routes an identical prompt directly to a provider vs. via EcoGate (with payload compression and routing engaged).

```bash
cd ecogate/server
node compare-test.js --provider=google
```

The script will give you a detailed report of the exact token reduction, latency differences, carbon metric evaluations, and routing adjustments!

---

## CarbonLint — GitHub Action

CarbonLint reviews every Pull Request for wasteful LLM usage patterns and posts a **Green Score (A–F)** comment.

**Patterns detected:**
- 🔴 Calling large models (GPT-4, Opus) for simple tasks
- 🔴 LLM API calls inside loops without batching
- 🟠 Not caching repeated identical prompts
- 🟠 Excessive `max_tokens` for short responses
- 🟡 Sending full documents when only a summary is needed

### Add CarbonLint to your repo

Create `.github/workflows/carbon-lint.yml` in your repository:

```yaml
name: CarbonLint — Green Score
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  carbon-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Generate diff
        run: |
          git fetch origin ${{ github.base_ref }}
          git diff origin/${{ github.base_ref }}...HEAD -- '*.js' '*.ts' '*.py' > $RUNNER_TEMP/pr.diff || true
      - uses: AartiHN123/Ecogate/carbon-lint@main
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token:   ${{ secrets.GITHUB_TOKEN }}
```

Add your `OPENAI_API_KEY` as a repository secret and you're done.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Proxy listen port |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `GOOGLE_API_KEY` | — | Google Gemini API key |
| `GROQ_API_KEY` | — | Groq API key |
| `MISTRAL_API_KEY` | — | Mistral AI API key |
| `TOGETHER_API_KEY` | — | Together AI API key |
| `ZAI_API_KEY` | — | Z.AI (GLM) API key |
| `CLASSIFIER_PROVIDER` | `openai` | Provider to use for complexity classifier |
| `CLASSIFIER_MODEL` | `gpt-4o-mini` | Model to use for complexity classifier |
| `CLASSIFIER_API_KEY` | *(provider key)* | Override API key for classifier only |
| `ECOGATE_RESPECT_MODEL` | `false` | Set `true` to skip routing and honour caller's model |
| `ROUTER_OPENAI_SMALL` | `gpt-4o-mini` | Override small-tier model for OpenAI |
| `ROUTER_OPENAI_MEDIUM` | `gpt-4o` | Override medium-tier model for OpenAI |
| `ROUTER_OPENAI_LARGE` | `gpt-4-turbo` | Override large-tier model for OpenAI |

*(Same `ROUTER_<PROVIDER>_<TIER>` pattern applies for all providers.)*

---

## Carbon Calculation

EcoGate estimates emissions using published GPU specs and model parameter counts:

```
carbon_g = (total_tokens / 1000) × carbon_factor_per_1k_tokens
savings_g = carbon_if_large_model_used - carbon_actual
```

| Tier | Example Models | gCO₂ per 1K tokens |
|------|---------------|-------------------|
| Small | gpt-4o-mini, claude-haiku, gemini-flash | 0.02 |
| Medium | gpt-4o, claude-sonnet, gemini-pro | 0.15 |
| Large | gpt-4-turbo, claude-opus | 0.45 |

*These are hackathon estimates. Production would use real-time grid intensity APIs (ElectricityMaps, WattTime) and actual GPU power draw measurements.*

---

## WebSocket Real-Time Events

Connect to `ws://localhost:3000/ws` for live updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  // type: 'request_complete' | 'stats_update' | 'ping'
};
```

| Event | Payload |
|-------|---------|
| `request_complete` | `{ provider, model, tokens_in, tokens_out, carbon_g, savings_g, savings_pct, routing_tier, streamed, ... }` |
| `stats_update` | Full `getStats()` object (totals + breakdown) |
| `ping` | Sent on connect to confirm live connection |

---

## Project Structure

```
Ecogate/
├── ecogate/
│   ├── server/           — Node.js Proxy, Routing Logic, and SQLite DB
│   │   ├── compare-test.js — A/B Testing Benchmark tool
│   │   ├── compressor.js   — Connects Node.js to Python NLP
│   │   ├── prompt-cache.js — Semantic exact-match caching
│   │   └── ...
│   ├── dashboard/        — Modern React/Vite Dashboard Interface
│   │   ├── src/          — Tailwind + React Components
│   │   └── ...
│   └── nlp-sidecar/      — Python FastAPI Prompt Compression Engine
│       ├── main.py       — Sidecar Entrypoint
│       └── pipeline.py   — LLMLingua-2 & Stop-word logic
├── carbon-lint/
│   ├── action.yml          — GitHub Action definition
│   ├── lint.js             — LLM diff analyzer + PR comment poster
│   └── example-workflow.yml — Copy this into your repo's .github/workflows/
├── docker-compose.yml      — Full stack in one command
├── install.sh              — Simple Magic 1-click Installer
└── README.md               — This file
```

---

## License

MIT — Build on it, fork it, make AI greener.
