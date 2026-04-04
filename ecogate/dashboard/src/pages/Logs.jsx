import { useState, useEffect, useCallback } from 'react'

const API = '/api'

function TierBadge({ tier }) {
  const cls = `badge badge-${tier ?? 'medium'}`
  return <span className={cls}>{tier ?? 'medium'}</span>
}

export default function Logs() {
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [limit,   setLimit]   = useState(100)
  const [filter,  setFilter]  = useState('')

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/logs?limit=${limit}`)
      if (res.ok) setLogs(await res.json())
    } catch (_) {}
    finally { setLoading(false) }
  }, [limit])

  useEffect(() => {
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [fetchLogs])

  const filtered = logs.filter(l =>
    !filter || l.model?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div>
      <div className="page-header">
        <h2>📋 Request Logs</h2>
        <p>Every inference request routed through EcoGate with carbon data</p>
      </div>

      <div className="table-card">
        <div className="table-header">
          <h3>Recent Requests</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              id="log-filter"
              placeholder="Filter by model…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-bright)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '6px 12px',
                fontSize: '0.8rem',
                outline: 'none',
              }}
            />
            <select
              id="log-limit"
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-bright)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '6px 10px',
                fontSize: '0.8rem',
                outline: 'none',
              }}
            >
              <option value={50}>Last 50</option>
              <option value={100}>Last 100</option>
              <option value={250}>Last 250</option>
              <option value={500}>Last 500</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading-state"><div className="spinner" /> Loading…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Model</th>
                  <th>Tier</th>
                  <th>Complexity</th>
                  <th>Tokens In</th>
                  <th>Tokens Out</th>
                  <th>Carbon (g)</th>
                  <th>Saved (g)</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      No requests yet — point your app at the proxy and fire some queries!
                    </td>
                  </tr>
                ) : filtered.map(log => (
                  <tr key={log.id}>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(log.created_at).toLocaleTimeString()}
                    </td>
                    <td style={{ color: 'var(--accent)' }}>{log.model}</td>
                    <td><TierBadge tier={log.tier} /></td>
                    <td style={{ textAlign: 'center' }}>{log.complexity}</td>
                    <td>{log.tokens_in?.toLocaleString()}</td>
                    <td>{log.tokens_out?.toLocaleString()}</td>
                    <td style={{ color: '#f87171' }}>{log.carbon_g?.toFixed(5)}</td>
                    <td style={{ color: 'var(--green-400)' }}>{log.saved_g?.toFixed(5)}</td>
                    <td>{log.latency_ms?.toLocaleString()} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
