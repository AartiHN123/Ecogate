import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { formatCarbon, formatLatency, formatNum } from '../utils/carbon'
import TierBadge from '../components/TierBadge'
import ProviderBadge from '../components/ProviderBadge'

const COLUMNS = [
  { key: 'id',               label: '#',           width: '52px' },
  { key: 'timestamp',        label: 'Time',         width: '140px' },
  { key: 'provider',         label: 'Provider',     width: '110px' },
  { key: 'model',            label: 'Model',        width: '180px' },
  { key: 'routing_tier',     label: 'Tier',         width: '90px' },
  { key: 'complexity_score', label: 'Score',        width: '65px' },
  { key: 'tokens_in',        label: 'Tokens ↑',    width: '80px' },
  { key: 'tokens_out',       label: 'Tokens ↓',    width: '80px' },
  { key: 'latency_ms',       label: 'Latency',      width: '80px' },
  { key: 'carbon_g',         label: 'Carbon',       width: '90px' },
  { key: 'savings_g',        label: 'Saved',        width: '90px' },
  { key: 'was_routed',       label: 'Routing',      width: '90px' },
]

function ScoreDot({ score }) {
  const colors = { 1: '#4ade80', 2: '#86efac', 3: '#fbbf24', 4: '#fb923c', 5: '#f87171' }
  return (
    <div className="flex items-center gap-1.5">
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors[score] ?? '#94a3b8', flexShrink: 0 }} />
      <span className="font-mono">{score ?? '—'}</span>
    </div>
  )
}

function SourceTooltip({ source }) {
  const [show, setShow] = useState(false)
  if (!source) return null
  return (
    <span
      className="relative ml-1 text-xs cursor-help"
      style={{ color: 'var(--color-text-muted)' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {source === 'llm' ? '🤖' : '⚙'}
      {show && (
        <span
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded-lg text-xs whitespace-nowrap z-10"
          style={{ background: 'rgba(10,15,13,0.97)', border: '1px solid var(--color-border-hover)', color: 'var(--color-text-primary)' }}
        >
          {source === 'llm' ? 'LLM classifier' : 'Heuristic fallback'}
        </span>
      )}
    </span>
  )
}

export default function Logs() {
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterTier, setFilterTier] = useState('')
  const [sortKey, setSortKey] = useState('id')
  const [sortDir, setSortDir] = useState('desc')
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchLogs = useCallback(async () => {
    try {
      const data = await api.logs(500)
      setLogs(data)
      setError(null)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [fetchLogs])

  const providers = useMemo(() => [...new Set(logs.map(l => l.provider))].filter(Boolean).sort(), [logs])
  const tiers = ['small', 'medium', 'large', 'caller']

  const filtered = useMemo(() => {
    let rows = logs
    if (filterProvider) rows = rows.filter(r => r.provider === filterProvider)
    if (filterTier) rows = rows.filter(r => r.routing_tier === filterTier)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.model?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q) ||
        String(r.id).includes(q)
      )
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      if (sortDir === 'asc') return av > bv ? 1 : -1
      return av < bv ? 1 : -1
    })
  }, [logs, filterProvider, filterTier, search, sortKey, sortDir])

  function handleSort(key) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function fmtTime(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function renderCell(row, col) {
    switch (col.key) {
      case 'id':               return <span className="font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>#{row.id}</span>
      case 'timestamp':        return <span className="font-mono text-xs">{fmtTime(row.timestamp)}</span>
      case 'provider':         return <ProviderBadge provider={row.provider} />
      case 'model':            return <span className="font-mono text-xs" style={{ color: 'var(--color-text-secondary)' }}>{row.model}</span>
      case 'routing_tier':     return <TierBadge tier={row.routing_tier} />
      case 'complexity_score': return (
        <div className="flex items-center">
          <ScoreDot score={row.complexity_score} />
          <SourceTooltip source={row.complexity_source} />
        </div>
      )
      case 'tokens_in':        return <span className="font-mono text-xs">{formatNum(row.tokens_in)}</span>
      case 'tokens_out':       return <span className="font-mono text-xs">{formatNum(row.tokens_out)}</span>
      case 'latency_ms':       return <span className="font-mono text-xs">{formatLatency(row.latency_ms)}</span>
      case 'carbon_g':         return <span className="font-mono text-xs" style={{ color: '#f87171' }}>{formatCarbon(row.carbon_g)}</span>
      case 'savings_g':        return <span className="font-mono text-xs" style={{ color: '#4ade80' }}>{formatCarbon(row.savings_g)}</span>
      case 'was_routed':       return row.was_routed
        ? <span className="badge-routed">Routed</span>
        : <span className="badge-bypassed">Bypassed</span>
      default:                 return row[col.key] ?? '—'
    }
  }

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            📋 Request Logs
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {filtered.length} of {logs.length} requests
            {lastUpdated && ` · ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        {error && (
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search model, provider, ID…"
          className="input-field"
          style={{ maxWidth: 260 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="input-field"
          style={{ maxWidth: 150 }}
          value={filterProvider}
          onChange={e => setFilterProvider(e.target.value)}
        >
          <option value="">All providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          className="input-field"
          style={{ maxWidth: 140 }}
          value={filterTier}
          onChange={e => setFilterTier(e.target.value)}
        >
          <option value="">All tiers</option>
          {tiers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || filterProvider || filterTier) && (
          <button className="btn-ghost" onClick={() => { setSearch(''); setFilterProvider(''); setFilterTier('') }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <span className="text-5xl">🌱</span>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>No requests logged yet.</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Send a request through the proxy at <code className="font-mono" style={{ color: 'var(--color-accent)' }}>http://localhost:3000/v1/chat/completions</code>
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      style={{ width: col.width, minWidth: col.width, cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key && (
                          <span style={{ color: 'var(--color-accent)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map(row => (
                  <tr key={row.id}>
                    {COLUMNS.map(col => (
                      <td key={col.key}>{renderCell(row, col)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-2 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
                Showing 200 of {filtered.length} rows — refine your filter to see more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
