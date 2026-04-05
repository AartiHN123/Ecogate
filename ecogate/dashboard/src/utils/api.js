// All API calls centralised here.
// Vite proxy forwards /api, /v1, /health to http://localhost:3000

const API_BASE = ''

async function request(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json()
}

export const api = {
  health: () => request('/health'),
  providers: () => request('/v1/providers'),
  models: (provider) => request(provider ? `/api/models?provider=${provider}` : '/api/models'),
  logs: (limit = 200) => request(`/api/logs?limit=${limit}`),
  stats: () => request('/api/stats'),
}
