# EcoGate
**The Carbon Diet for AI Inference**
*Hackathon Implementation Guide — 24-Hour Build Plan*
*Sustainability Challenge • 2-Person Team • Full Stack + AI*

## 1. Project Overview
EcoGate is an AI inference proxy that sits between applications and LLM APIs (OpenAI, Anthropic, etc.). It does three things: routes requests to the smallest capable model (cutting GPU burn), tracks carbon emissions per request, and provides a dashboard showing environmental impact. Think Clawzempic, but the metric is CO2 saved, not dollars.

**Core Value Proposition**
* **Smart Model Routing:** Simple queries go to small models, complex ones go to big models. 80-90% of requests don't need GPT-4/Opus level.
* **Carbon Tracking:** Every API call gets tagged with estimated gCO2 based on model size, token count, and data center region.
* **Green Dashboard:** Real-time visualization of emissions saved, equivalent trees planted, car miles offset.
* **Drop-in Replacement:** Change one base URL in your app config; zero code changes needed.

**Why Judges Will Love This**
* **Innovation:** No one is framing AI cost optimization as an environmental tool, making this a fresh angle.
* **Technical Execution:** Proxy server + classifier + dashboard = multiple technical layers to demo.
* **Environmental Impact:** Direct, measurable carbon reduction instead of a vague "awareness" tool.
* **Feasibility:** Working POC in 24 hours that is scalable to production with the same architecture.

## 2. System Architecture
The system has four main components that work together as a pipeline:

**Component Breakdown**
* **A) Proxy Server (Core)**
    * Express.js or FastAPI server that mimics OpenAI's /v1/chat/completions endpoint.
    * Accepts standard OpenAI-format requests, so apps think they're talking to OpenAI.
    * Intercepts the request, runs it through the classifier, routes to the optimal model, and returns the response.
    * Logs every request with: timestamp, input tokens, output tokens, model used, and estimated carbon.
* **B) Complexity Classifier**
    * A lightweight LLM call (or rule-based system) that scores incoming prompts 1-5 on complexity.
    * Score 1-2: Route to small model (GPT-4o-mini, Haiku, etc.).
    * Score 3: Route to medium model (GPT-4o, Sonnet).
    * Score 4-5: Route to large model (GPT-4, Opus).
    * Fallback: If the classifier fails, it defaults to a medium model.
* **C) Carbon Calculator Engine**
    * Maps each model to estimated watts-per-token based on published GPU specs and model size.
    * Formula: carbon_g = tokens * watts_per_token * duration_s * grid_carbon_intensity_g_per_kwh.
    * Uses regional grid carbon intensity data (e.g., US average ~0.4 kg CO2/kWh).
    * Compares the carbon if routed to the biggest model vs. the carbon of the actual model used to calculate savings.
* **D) Green Dashboard (Frontend)**
    * React app with real-time charts showing: total requests, carbon saved, and a model distribution pie chart.
    * Fun equivalency cards: "You saved 2.3kg CO2 = 10 miles not driven" type metrics.
    * Per-request log table with carbon cost per call.
    * GitHub-style contribution graph, but for carbon savings.

## 3. Tech Stack

| Layer | Technology | Why This Choice |
| :--- | :--- | :--- |
| Proxy Server | Node.js + Express | Fast setup, async-friendly, OpenAI SDK works natively |
| Classifier | OpenAI GPT-4o-mini | Cheap, fast, good enough to classify complexity |
| Database | SQLite (dev) / PostgreSQL | Zero config for hackathon, migrate later |
| Dashboard | React + Recharts + Tailwind | Fast to build, great charts, pretty by default |
| Carbon Data | JSON lookup table | Hardcoded model-to-carbon mappings. Simple, works. |
| Deployment | Docker Compose (local) | One command up. Demo from laptop. |
| CI/CD Hook | GitHub Action (optional) | Bonus: lint PRs for wasteful LLM patterns |

## 4. The 24-Hour Battle Plan
Two cave-people. One mission. Here is the hour-by-hour plan where Person A = Backend/AI and Person B = Frontend/DevOps.

**Phase 1: Foundation (Hours 0–4)**

| Hour | Person A (Backend) | Person B (Frontend) |
| :--- | :--- | :--- |
| 0–1 | Set up Node.js project, Express server, basic /v1/chat/completions endpoint that just forwards to OpenAI | Set up React project with Vite, install Tailwind + Recharts, build layout shell with sidebar nav |
| 1–2 | Add request logging to SQLite: timestamp, model, tokens_in, tokens_out, latency | Build the main dashboard page: placeholder cards for total requests, carbon saved, model split |
| 2–3 | Build complexity classifier: send prompt to GPT-4o-mini with scoring rubric, parse score | Build request log table component with sorting and filtering |
| 3–4 | Implement model routing logic based on classifier score. Test with sample queries. | Connect frontend to backend API. GET /api/stats and GET /api/logs endpoints. |

**Phase 2: Core Features (Hours 4–10)**

| Hour | Person A (Backend) | Person B (Frontend) |
| :--- | :--- | :--- |
| 4–6 | Build carbon calculator engine. Create JSON lookup of watts-per-token per model. Implement formula. | Build carbon savings chart (line chart over time) and model distribution pie chart with Recharts |
| 6–8 | Add "savings comparison" logic: calculate what carbon WOULD have been if always using biggest model | Build equivalency cards: trees planted, miles not driven, phones charged. Make them animate. |
| 8–10 | Add support for Anthropic API format alongside OpenAI. Test both providers routing correctly. | Build settings page: configure API keys, set default models per tier, view routing rules |

**Phase 3: Polish + Bonus (Hours 10–18)**

| Hour | Person A (Backend) | Person B (Frontend) |
| :--- | :--- | :--- |
| 10–12 | Build CarbonLint GitHub Action: analyze git diffs for wasteful LLM patterns using GPT-4o-mini | Build GitHub-style carbon heatmap (contribution graph but green = carbon saved per day) |
| 12–14 | Add WebSocket for real-time dashboard updates as requests flow through proxy | Add real-time animations: numbers tick up, charts update live when proxy handles requests |
| 14–16 | Write Docker Compose file. Test full stack in containers. Fix any bugs. | Add onboarding flow: "Change your base URL to localhost:3000 and you're done" walkthrough |
| 16–18 | Seed demo data: simulate 1000 requests with realistic patterns to make dashboard look impressive | Polish UI: dark mode toggle, responsive layout, loading states, error handling |

**Phase 4: Demo Prep (Hours 18–24)**

| Hour | Person A (Backend) | Person B (Frontend) |
| :--- | :--- | :--- |
| 18–20 | BOTH: Write demo script. Practice the 3-minute pitch. Decide who presents what. | |
| 20–22 | BOTH: Record backup demo video in case of technical issues. Final bug squash. | |
| 22–24 | BOTH: Sleep if possible. Final run-through 1 hour before presentation. | |

## 5. Key Implementation Details
**5.1 The Proxy Endpoint**
* The proxy server exposes a single endpoint that mimics OpenAI's chat completions API.
* Any app that uses the OpenAI SDK can point to your proxy by changing one environment variable: `OPENAI_BASE_URL=http://localhost:3000/v1`.
* The proxy intercepts the request, classifies complexity, picks the optimal model, forwards the request, logs carbon data, and returns the response in the exact same format the app expects.

**5.2 Complexity Classifier Prompt**
* The classifier is a fast LLM call that reads the user's prompt and returns a score from 1 to 5.
* The system prompt should say something like: "You are a complexity scorer. Given a user prompt, rate its complexity from 1-5. Score 1 = simple factual lookup or greeting. Score 2 = basic Q&A or formatting. Score 3 = moderate reasoning or summarization. Score 4 = complex analysis, multi-step reasoning, or code generation. Score 5 = advanced research, creative writing, or expert-level tasks. Respond with ONLY the number."
* Important: Use GPT-4o-mini or Haiku for the classifier itself because it must be fast (under 500ms) and cheap. The classifier cost should be negligible compared to savings.

**5.3 Carbon Calculation Formula**
* Each model gets a carbon-per-token estimate based on its parameter count and typical GPU usage.
* Here is the simplified formula: `carbon_grams = total_tokens * carbon_factor_per_token * grid_intensity_factor`.

| Model | Est. Parameters | Carbon Factor (gCO2/1K tokens) |
| :--- | :--- | :--- |
| GPT-4o-mini / Haiku | ~8B | 0.02 |
| GPT-4o / Sonnet | ~70-200B | 0.15 |
| GPT-4 / Opus | ~1.8T (MoE) | 0.45 |

* These are estimates for the hackathon demo; in production, you would use actual GPU power draw measurements and real-time grid carbon intensity APIs like ElectricityMaps or WattTime.

**5.4 Model Routing Map**

| Score | Complexity | OpenAI Route | Anthropic Route | Carbon Savings |
| :--- | :--- | :--- | :--- | :--- |
| 1–2 | Simple | gpt-4o-mini | claude-haiku | ~90% |
| 3 | Medium | gpt-4o | claude-sonnet | ~60% |
| 4–5 | Complex | gpt-4 | claude-opus | 0% (baseline) |

**5.5 CarbonLint — GitHub Action (Bonus Feature)**
* This is the bonus feature that combines the GitHub CI angle.
* A GitHub Action that runs on every PR and uses an LLM to scan the code diff for wasteful AI patterns.
* It comments on the PR with suggestions.
* Patterns to detect:
    * Calling large models (GPT-4, Opus) for tasks that a small model can handle (e.g., formatting, classification).
    * Making LLM calls inside loops without batching.
    * Not caching repeated identical prompts.
    * Using high max_tokens when response is expected to be short.
    * Sending full documents when only a summary is needed.
* The Action reads the git diff, sends it to GPT-4o-mini with a specialized prompt, and posts a PR comment with a "Green Score" (A-F) plus specific line-by-line suggestions. This is a strong differentiator for the demo.

## 6. Demo Script (3 Minutes)
This is the exact flow for your hackathon presentation. Practice this.

* **Minute 1: The Problem**
    * Open with: "AI inference is the fastest-growing source of tech carbon emissions. A single GPT-4 query uses 10x the energy of a Google search. And 80% of those queries don't even need GPT-4."
    * Show a simple stat slide: "By 2030, AI data centers could consume as much electricity as a small country."
    * "We built EcoGate — the carbon diet for AI inference."
* **Minute 2: Live Demo**
    * Show a sample app making API calls through EcoGate proxy (live terminal).
    * Fire off 5-6 queries of varying complexity and show the dashboard updating in real-time.
    * Point out: "This simple greeting went to Haiku. This complex analysis went to Opus. Same app, zero code changes."
    * Show the carbon savings dashboard: pie chart, line graph, equivalency cards.
    * Quick flash of CarbonLint: show a PR comment flagging wasteful LLM usage.
* **Minute 3: Impact + Vision**
    * "In our test run of 1,000 requests, EcoGate reduced carbon emissions by 78%."
    * "That's equivalent to [X] trees planted or [Y] miles not driven."
    * Scale vision: "Every company using AI APIs could plug in EcoGate today. One line config change. Imagine if every ChatGPT wrapper app routed intelligently."
    * Close: "We're not asking people to use less AI. We're making AI use less planet."

## 7. Project File Structure
* `ecogate/`
    * `server/` — The proxy backend
        * `server/index.js` — Express server, main proxy endpoint
        * `server/classifier.js` — Complexity scoring logic
        * `server/router.js` — Model selection based on score
        * `server/carbon.js` — Carbon calculation engine
        * `server/db.js` — SQLite setup and query helpers
        * `server/models.json` — Carbon factor lookup table per model
    * `dashboard/` — React frontend
        * `dashboard/src/App.jsx` — Main app with routing
        * `dashboard/src/pages/Dashboard.jsx` — Main stats view
        * `dashboard/src/pages/Logs.jsx` — Request log table
        * `dashboard/src/pages/Settings.jsx` — Configuration
        * `dashboard/src/components/` — Cards, charts, heatmap
    * `carbon-lint/` — GitHub Action files
        * `carbon-lint/action.yml` — Action definition
        * `carbon-lint/lint.js` — Diff analyzer script
    * `docker-compose.yml` — Full stack in one command
    * `README.md` — Setup instructions + screenshots

## 8. Survival Tips for the 24 Hours
**Do's**
* Use AI tools aggressively to write boilerplate to save brain power for architecture decisions.
* Get a working end-to-end flow in the first 4 hours, even if ugly, because demo-ability beats perfection.
* Seed realistic demo data early because a dashboard with 1000 data points looks 10x more impressive than one with 5.
* Record a backup demo video at hour 20; WiFi dies at hackathons, so be prepared.
* Keep the proxy compatible with OpenAI's exact request/response format as this is the magic of the product.

**Don'ts**
* Don't build user auth. It's a hackathon; just hardcode an API key.
* Don't use a complex database. SQLite is fine, and you can say "production version uses Postgres" in the pitch.
* Don't spend more than 30 minutes on any single bug. Skip it, mark it as TODO, and move on.
* Don't forget to eat. Seriously. Schedule food breaks at hours 6, 12, and 18.
* Don't over-polish one feature at the expense of having all features working. Breadth beats depth for demos.

**Secret Weapons**
* The closing line "We're not asking people to use less AI. We're making AI use less planet." — Memorize this. End every conversation with it.
* The real-time dashboard updating as queries flow through — this is the "wow" moment, so make sure it works flawlessly.
* The one-line setup (just change OPENAI_BASE_URL) — this proves feasibility better than any slide.