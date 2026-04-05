import { useEffect, useState } from 'react'
import { api } from '../utils/api'
import ProviderBadge from '../components/ProviderBadge'
import TierBadge from '../components/TierBadge'

const CODE_SNIPPET = `# Change one env var — zero code changes needed
OPENAI_BASE_URL=http://localhost:3000/v1

# Or pass it to any OpenAI SDK:
client = OpenAI(base_url="http://localhost:3000/v1", api_key="any-key")
`

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button className="btn-ghost text-xs" onClick={copy}>
      {copied ? '✅ Copied' : '📋 Copy'}
    </button>
  )
}

function EnvVarRow({ name, value, description }) {
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <code className="font-mono text-xs px-2 py-1 rounded-md flex-shrink-0" style={{ background: 'rgba(74,222,128,0.08)', color: 'var(--color-accent)' }}>
        {name}
      </code>
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{description}</p>
      </div>
    </div>
  )
}

export default function Settings() {
  const [providers, setProviders] = useState([])
  const [models, setModels] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const [p, m] = await Promise.all([api.providers(), api.models()])
        setProviders(p)
        setModels(m)
      } catch (e) {
        setError(e.message)
      }
    }
    load()
  }, [])

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          ⚙️ Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Proxy configuration and integration reference
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
          ⚠ Could not reach backend: {error}
        </div>
      )}

      {/* Integration snippet */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Drop-in Integration
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              One config change — no code modifications needed
            </p>
          </div>
          <CopyButton text={CODE_SNIPPET} />
        </div>
        <pre
          className="text-xs rounded-xl p-4 overflow-x-auto leading-relaxed"
          style={{ background: 'rgba(0,0,0,0.4)', color: '#86efac', fontFamily: "'JetBrains Mono', monospace", border: '1px solid var(--color-border)' }}
        >
          {CODE_SNIPPET}
        </pre>
      </div>

      {/* Providers */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          Registered Providers
        </h2>
        {providers.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map(p => {
              const buckets = models[p.id] || {}
              return (
                <div key={p.id} className="rounded-xl p-4" style={{ background: 'rgba(74,222,128,0.03)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <ProviderBadge provider={p.id} />
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{p.name}</span>
                      <span
                        className={`badge ${p.enabled ? 'badge-small' : 'badge-bypassed'}`}
                      >
                        {p.enabled ? '● Enabled' : '○ No key'}
                      </span>
                    </div>
                    <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                      Default: {p.defaultModel}
                    </span>
                  </div>

                  {/* Model Tiers */}
                  {(buckets.small || buckets.medium || buckets.large) && (
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      {['small', 'medium', 'large'].map(tier => {
                        const model = buckets[tier]?.[0] || '—'
                        return (
                          <div key={tier} className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--color-border)' }}>
                            <div className="mb-1"><TierBadge tier={tier} /></div>
                            <p className="text-xs font-mono truncate" style={{ color: 'var(--color-text-secondary)' }} title={model}>{model}</p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Env Var reference */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          Environment Variables Reference
        </h2>
        <div>
          <EnvVarRow
            name="CLASSIFIER_PROVIDER"
            value="openai | anthropic | google | zai | groq | mistral | together"
            description="Which provider to use for the complexity classifier (default: openai)"
          />
          <EnvVarRow
            name="CLASSIFIER_MODEL"
            value="e.g. gpt-4o-mini"
            description="Override the classifier model (default: each provider's fastest small model)"
          />
          <EnvVarRow
            name="CLASSIFIER_API_KEY"
            value="sk-…"
            description="Override API key specifically for classifier (default: provider's env key)"
          />
          <EnvVarRow
            name="ECOGATE_RESPECT_MODEL"
            value="true | false"
            description="If true, honour the caller's requested model and skip routing (default: false)"
          />
          <EnvVarRow
            name="ROUTER_OPENAI_SMALL"
            value="gpt-4o-mini"
            description="Override small-tier model for OpenAI (also: _MEDIUM, _LARGE)"
          />
          <EnvVarRow
            name="ROUTER_ANTHROPIC_SMALL"
            value="claude-3-haiku-20240307"
            description="Override small-tier model for Anthropic (also: _MEDIUM, _LARGE)"
          />
          <EnvVarRow
            name="PORT"
            value="3000"
            description="Port the proxy server listens on"
          />
        </div>
      </div>

      {/* Routing map */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
          Complexity → Model Routing
        </h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Score</th>
                <th>Complexity</th>
                <th>Tier</th>
                <th>OpenAI Route</th>
                <th>Anthropic Route</th>
                <th>Est. Carbon Savings</th>
              </tr>
            </thead>
            <tbody>
              {[
                { score: '1–2', complexity: 'Simple factual / greeting', tier: 'small', openai: 'gpt-4o-mini', anthropic: 'claude-3-haiku-…', savings: '~90%' },
                { score: '3',   complexity: 'Moderate reasoning / summarisation', tier: 'medium', openai: 'gpt-4o', anthropic: 'claude-3-5-sonnet-…', savings: '~60%' },
                { score: '4–5', complexity: 'Complex analysis / expert tasks', tier: 'large', openai: 'gpt-4-turbo', anthropic: 'claude-3-opus-…', savings: '0% (baseline)' },
              ].map(row => (
                <tr key={row.score}>
                  <td><span className="font-mono text-xs font-bold" style={{ color: 'var(--color-accent)' }}>{row.score}</span></td>
                  <td><span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{row.complexity}</span></td>
                  <td><TierBadge tier={row.tier} /></td>
                  <td><span className="font-mono text-xs">{row.openai}</span></td>
                  <td><span className="font-mono text-xs">{row.anthropic}</span></td>
                  <td><span className="text-xs font-semibold" style={{ color: row.tier === 'large' ? 'var(--color-text-muted)' : '#4ade80' }}>{row.savings}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
