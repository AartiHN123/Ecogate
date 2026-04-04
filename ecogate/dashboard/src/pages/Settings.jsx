import MODELS from '../utils/models'

const ROUTING_TABLE = {
  openai: {
    small:  'gpt-4o-mini',
    medium: 'gpt-4o',
    large:  'gpt-4',
  },
  anthropic: {
    small:  'claude-haiku-3-5',
    medium: 'claude-sonnet-4-5',
    large:  'claude-opus-4-5',
  },
}

export default function Settings() {
  return (
    <div>
      <div className="page-header">
        <h2>⚙️ Settings & Configuration</h2>
        <p>EcoGate proxy routing rules and model configuration</p>
      </div>

      {/* Proxy Setup */}
      <div className="settings-section">
        <h3>🔌 Drop-in Proxy Setup</h3>
        <div className="setting-row">
          <span className="setting-label">Set this env var in your app</span>
          <code className="setting-value">OPENAI_BASE_URL=http://localhost:3000/v1</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Proxy endpoint</span>
          <code className="setting-value">POST /v1/chat/completions</code>
        </div>
        <div className="setting-row">
          <span className="setting-label">Health check</span>
          <code className="setting-value">GET /health</code>
        </div>
      </div>

      {/* Routing Rules */}
      <div className="settings-section">
        <h3>🗺️ Routing Rules</h3>
        {['openai', 'anthropic'].map(provider => (
          <div key={provider} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              {provider}
            </div>
            {['small', 'medium', 'large'].map(tier => (
              <div key={tier} className="setting-row">
                <span className="setting-label">
                  Score {tier === 'small' ? '1–2' : tier === 'medium' ? '3' : '4–5'} — {tier}
                </span>
                <code className="setting-value">{ROUTING_TABLE[provider][tier]}</code>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Carbon Factors */}
      <div className="settings-section">
        <h3>🌱 Carbon Factors (gCO₂ per 1K tokens)</h3>
        {Object.entries(MODELS).map(([name, m]) => (
          <div key={name} className="setting-row">
            <span className="setting-label">
              {m.displayName}
              <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--text-muted)' }}>({m.tier})</span>
            </span>
            <code className="setting-value">{m.carbon_per_1k_tokens_g} g</code>
          </div>
        ))}
      </div>
    </div>
  )
}
