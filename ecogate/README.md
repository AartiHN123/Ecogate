# 🌿 EcoGate — The Carbon Diet for AI Inference

> *"We're not asking people to use less AI. We're making AI use less planet."*

EcoGate is an AI inference proxy that sits between your applications and LLM APIs. It **automatically routes requests to the smallest capable model**, **tracks carbon emissions per request**, and provides a **real-time green dashboard**.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔀 **Smart Routing** | Complexity classifier scores prompts 1–5; routes to small/medium/large models automatically |
| 🌱 **Carbon Tracking** | Every API call tagged with estimated gCO₂ based on model size + token count |
| 📊 **Green Dashboard** | Real-time charts — carbon saved, model distribution, equivalency cards, 30-day heatmap |
| 🔌 **Drop-in Replacement** | Change one env var (`OPENAI_BASE_URL`) — zero app code changes |
| 🧪 **CarbonLint** | GitHub Action that scores PRs for wasteful LLM patterns (A–F Green Score) |

---

## 🚀 Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- An OpenAI API key

### 1. Clone & Configure

```bash
git clone https://github.com/your-org/ecogate.git
cd ecogate

# Copy and fill in your API key
cp .env.example .env
# Edit .env → add your OPENAI_API_KEY
```

### 2. Start the Proxy Server

```bash
cd server
npm install
npm run dev
```

The proxy is now live at **http://localhost:3000**.

### 3. Start the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard is at **http://localhost:5173**.

### 4. Seed Demo Data (Optional)

```bash
cd server
npm run seed   # Inserts 1 000 realistic demo requests
```

### 5. Point Your App at EcoGate

In any app that uses the OpenAI SDK, set **one** environment variable:

```bash
OPENAI_BASE_URL=http://localhost:3000/v1
```

That's it. Zero other changes.

---

## 🐳 Docker (One Command)

```bash
# Copy and fill .env first
cp .env.example .env

docker compose up --build
```

| Service | URL |
|---|---|
| Proxy  | http://localhost:3000 |
| Dashboard | http://localhost:5173 |

---

## 📡 API Endpoints

### Proxy (OpenAI-compatible)
```
POST /v1/chat/completions   — Drop-in replacement for OpenAI
GET  /health                — Health check
```

### Dashboard API
```
GET /api/stats              — Aggregate stats (requests, carbon, tokens)
GET /api/logs?limit=100     — Recent request logs
GET /api/daily?days=30      — Daily carbon savings (for heatmap)
```

### Response Headers (every proxied request)
```
X-EcoGate-Model       — Model that actually handled the request
X-EcoGate-Tier        — small | medium | large
X-EcoGate-Complexity  — Classifier score 1–5
X-EcoGate-Carbon-G    — gCO₂ emitted
X-EcoGate-Saved-G     — gCO₂ saved vs always using the large model
```

---

## 🗂️ Project Structure

```
ecogate/
├── server/                 # Node.js + Express proxy
│   ├── index.js            # Server entry point
│   ├── classifier.js       # Prompt complexity scorer (GPT-4o-mini)
│   ├── router.js           # Model selection by score + provider
│   ├── carbon.js           # Carbon calculation engine
│   ├── db.js               # SQLite persistence layer
│   ├── models.json         # Carbon factor lookup table
│   ├── config.js           # Env var validation
│   ├── routes/
│   │   ├── chat.js         # POST /v1/chat/completions
│   │   └── api.js          # GET /api/stats, /logs, /daily
│   ├── middleware/
│   │   └── logger.js       # Morgan HTTP logger
│   └── scripts/
│       └── seed.js         # Demo data seeder
├── dashboard/              # React + Vite + Recharts
│   ├── src/
│   │   ├── App.jsx         # App shell + sidebar navigation
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx   # Stats, charts, heatmap
│   │   │   ├── Logs.jsx        # Request log table
│   │   │   └── Settings.jsx    # Config + routing rules viewer
│   │   └── utils/
│   │       └── carbon.js       # Client-side equivalency helper
│   ├── index.css           # Dark green glassmorphism theme
│   └── vite.config.js      # Vite + /api proxy config
├── carbon-lint/            # GitHub Action
│   ├── action.yml
│   └── lint.js             # PR diff analyser → Green Score
├── .github/
│   └── workflows/
│       └── carbon-lint.yml # Triggers CarbonLint on PRs
├── docker-compose.yml
└── .env.example
```

---

## 🌍 Carbon Calculation

| Model | Est. Parameters | gCO₂ / 1K tokens |
|---|---|---|
| GPT-4o-mini / Claude Haiku | ~8B | 0.02 |
| GPT-4o / Claude Sonnet | ~70–200B | 0.15 |
| GPT-4 / Claude Opus | ~1.8T (MoE) | 0.45 |

**Savings** = what the carbon _would have been_ if always routing to the largest model minus actual carbon used.

---

## 🧪 CarbonLint

CarbonLint runs on every PR and flags wasteful LLM patterns:

- Using large models for simple formatting/classification tasks
- LLM calls inside loops without batching
- Missing prompt caching for repeated identical inputs
- Excessive `max_tokens` for short-response tasks
- Sending full documents when only a summary is needed

**Green Score**: A (excellent) → F (wasteful). Posted as a PR comment automatically.

---

## 🛠️ Tech Stack

- **Proxy**: Node.js + Express
- **Database**: SQLite via `better-sqlite3`
- **Classifier**: OpenAI GPT-4o-mini
- **Dashboard**: React 18 + Vite + Recharts
- **Containerisation**: Docker + Docker Compose
- **CI/CD**: GitHub Actions (CarbonLint)

---

## 📄 License

MIT
