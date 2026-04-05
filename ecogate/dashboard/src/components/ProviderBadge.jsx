const PROVIDER_COLORS = {
  openai:    { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  anthropic: { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7' },
  google:    { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  groq:      { bg: 'rgba(251,146,60,0.12)', color: '#fb923c' },
  mistral:   { bg: 'rgba(234,179,8,0.12)',  color: '#eab308' },
  together:  { bg: 'rgba(236,72,153,0.12)', color: '#ec4899' },
  zai:       { bg: 'rgba(99,102,241,0.12)', color: '#6366f1' },
}

export default function ProviderBadge({ provider }) {
  const cfg = PROVIDER_COLORS[provider?.toLowerCase()] ?? { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' }
  return (
    <span
      className="badge font-mono capitalize"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {provider ?? '—'}
    </span>
  )
}
