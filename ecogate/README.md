# 🌿 EcoGate — The Carbon Diet for AI Inference

> *"We're not asking people to use less AI. We're making AI use less planet."*

EcoGate is an AI inference proxy that sits between your applications and LLM APIs. It **automatically routes requests to the smallest capable model**, **tracks carbon emissions per request**, and provides a **real-time green dashboard**.

---

## 🚀 Quick Start (Local Dev)

### Prerequisites
- Node.js 18+
- An OpenAI API key

### 1. Clone the repo
```bash
git clone https://github.com/AartiHN123/Ecogate.git
cd Ecogate/ecogate
```

### 2. Configure environment
```bash
cp .env.example .env
# Open .env and add your OPENAI_API_KEY
```

### 3. Start the proxy server
```powershell
cd server
npm install
npm run dev
# → http://localhost:3000
```

### 4. Seed demo data (optional but recommended)
```powershell
# In the same server/ directory
npm run seed
```

### 5. Start the dashboard (new terminal)
```powershell
cd dashboard
npm install
npm run dev
# → http://localhost:5173
```

---

## 📤 Git — What to Push

### Files that SHOULD be committed
```
ecogate/
├── .env.example                          ✅ Template (no secrets)
├── .gitignore                            ✅
├── README.md                             ✅
├── docker-compose.yml                    ✅
├── server/
│   ├── index.js                          ✅
│   ├── classifier.js                     ✅
│   ├── router.js                         ✅
│   ├── carbon.js                         ✅
│   ├── db.js                             ✅
│   ├── config.js                         ✅
│   ├── models.json                       ✅
│   ├── package.json                      ✅
│   ├── package-lock.json                 ✅
│   ├── Dockerfile                        ✅
│   ├── routes/chat.js                    ✅
│   ├── routes/api.js                     ✅
│   ├── middleware/logger.js              ✅
│   └── scripts/seed.js                   ✅
├── dashboard/
│   ├── index.html                        ✅
│   ├── vite.config.js                    ✅
│   ├── package.json                      ✅
│   ├── package-lock.json                 ✅
│   ├── nginx.conf                        ✅
│   ├── Dockerfile                        ✅
│   └── src/                              ✅ (all files inside)
└── carbon-lint/
    ├── action.yml                        ✅
    └── lint.js                           ✅
```

### Files that should NEVER be committed (already in .gitignore)
```
.env                    ← your API keys — NEVER push this
ecogate-data.json       ← runtime database
node_modules/           ← installed by npm install
dist/ / build/          ← generated build output
*.log                   ← log files
```

### Push commands
```powershell
# From the root GreenPrompt folder
git add .
git commit -m "feat: add EcoGate proxy, dashboard, CarbonLint"
git push origin dev
```

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

## ✨ Features

| Feature | Description |
|---|---|
| 🔀 **Smart Routing** | Complexity classifier scores prompts 1–5; routes to small/medium/large models |
| 🌱 **Carbon Tracking** | Every API call tagged with estimated gCO₂ |
| 📊 **Green Dashboard** | Real-time charts — carbon saved, model distribution, equivalency cards, 30-day heatmap |
| 🔌 **Drop-in Replacement** | Change one env var (`OPENAI_BASE_URL`) — zero app code changes |
| 🧪 **CarbonLint** | GitHub Action that scores PRs for wasteful LLM patterns (A–F Green Score) |

---

## 🗂️ Project Structure

```
ecogate/
├── server/                 # Node.js + Express proxy
│   ├── classifier.js       # Prompt complexity scorer (GPT-4o-mini)
│   ├── router.js           # Model selection by score + provider
│   ├── carbon.js           # Carbon calculation engine
│   ├── db.js               # JSON file persistence layer
│   ├── models.json         # Carbon factor lookup table
│   ├── routes/chat.js      # POST /v1/chat/completions
│   ├── routes/api.js       # GET /api/stats, /logs, /daily
│   └── scripts/seed.js     # Demo data seeder
├── dashboard/              # React + Vite + Recharts
│   └── src/pages/
│       ├── Dashboard.jsx   # Stats, charts, heatmap
│       ├── Logs.jsx        # Request log table
│       └── Settings.jsx    # Config + routing rules
├── carbon-lint/            # GitHub Action
│   ├── action.yml
│   └── lint.js             # PR diff analyser → Green Score
├── .github/workflows/
│   └── carbon-lint.yml     # Triggers CarbonLint on PRs
├── docker-compose.yml
└── .env.example
```

---

## 🐳 Docker (One Command)

```bash
cp .env.example .env   # fill in your keys first
docker compose up --build
```

| Service | URL |
|---|---|
| Proxy | http://localhost:3000 |
| Dashboard | http://localhost:5173 |

---

## 🌍 Carbon Calculation

| Model | Est. Parameters | gCO₂ / 1K tokens |
|---|---|---|
| GPT-4o-mini / Claude Haiku | ~8B | 0.02 |
| GPT-4o / Claude Sonnet | ~70–200B | 0.15 |
| GPT-4 / Claude Opus | ~1.8T (MoE) | 0.45 |

---

## 📄 License

MIT
