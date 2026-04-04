import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { equivalencies } from '../utils/carbon'

const API = '/api'
const POLL_INTERVAL = 5000 // Refresh every 5 seconds for live feel

const PIE_COLORS = ['#34d366', '#eab308', '#f87171', '#60a5fa', '#a78bfa']

function StatCard({ label, value, unit, sub, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function EquivCard({ emoji, value, label }) {
  return (
    <div className="equiv-card">
      <div className="equiv-emoji">{emoji}</div>
      <div className="equiv-value">{value}</div>
      <div className="equiv-label">{label}</div>
    </div>
  )
}

function CarbonHeatmap({ daily }) {
  if (!daily?.length) return <div className="loading-state">No data yet</div>

  // Normalise values for colour intensity
  const maxSaved = Math.max(...daily.map(d => d.saved_g), 0.0001)

  return (
    <div className="heatmap-grid">
      {daily.map(d => {
        const intensity = Math.min(d.saved_g / maxSaved, 1)
        const bg = `rgba(52, 211, 102, ${0.08 + intensity * 0.82})`
        return (
          <div
            key={d.date}
            className="heatmap-cell"
            style={{ background: bg }}
            data-tip={`${d.date}: ${d.saved_g?.toFixed(4)}g CO₂ saved`}
            title={`${d.date}: ${d.saved_g?.toFixed(4)}g CO₂ saved (${d.requests} req)`}
          />
        )
      })}
    </div>
  )
}

export default function Dashboard() {
  const [stats,  setStats]  = useState(null)
  const [daily,  setDaily]  = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [sRes, dRes] = await Promise.all([
        fetch(`${API}/stats`),
        fetch(`${API}/daily`),
      ])
      if (sRes.ok) setStats(await sRes.json())
      if (dRes.ok) setDaily(await dRes.json())
    } catch (_) {
      // Server not up yet — silently retry
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchData])

  const totalSaved = stats?.total_saved_g ?? 0
  const equiv      = equivalencies(totalSaved)

  // Build pie data from by_model
  const pieData = (stats?.by_model ?? []).map(m => ({
    name: m.model,
    value: m.count,
  }))

  // Build line chart data from daily (carbon saved over time)
  const lineData = daily.map(d => ({
    date:    d.date?.slice(5),           // MM-DD
    saved_g: +(d.saved_g ?? 0).toFixed(4),
    requests: d.requests,
  }))

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" /> Loading dashboard…
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h2>🌍 Carbon Dashboard</h2>
        <p>Real-time AI inference emissions tracker — live updates every 5 s</p>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────── */}
      <div className="stats-grid">
        <StatCard
          label="Total Requests"
          value={(stats?.total_requests ?? 0).toLocaleString()}
          icon="🔁"
          sub="All-time through EcoGate proxy"
        />
        <StatCard
          label="Carbon Saved"
          value={(totalSaved / 1000).toFixed(3)}
          unit="kg CO₂"
          icon="🌿"
          sub={`vs always using the largest model`}
        />
        <StatCard
          label="Carbon Emitted"
          value={((stats?.total_carbon_g ?? 0) / 1000).toFixed(3)}
          unit="kg CO₂"
          icon="⚡"
          sub="Actual inference emissions"
        />
        <StatCard
          label="Total Tokens"
          value={((stats?.total_tokens ?? 0) / 1e6).toFixed(2)}
          unit="M"
          icon="🔤"
          sub="Prompt + completion tokens"
        />
      </div>

      {/* ── Equivalency Cards ──────────────────────────────── */}
      <div className="equiv-grid">
        <EquivCard emoji="🌳" value={equiv.trees.toFixed(2)}     label="Tree-days of absorption" />
        <EquivCard emoji="🚗" value={equiv.car_miles.toFixed(2)} label="Car miles offset" />
        <EquivCard emoji="📱" value={equiv.phones_charged.toFixed(0)} label="Phones charged" />
        <EquivCard emoji="📉" value={totalSaved > 0 ? Math.round((totalSaved / ((stats?.total_carbon_g ?? 1) + totalSaved)) * 100) + '%' : '0%'} label="Emissions reduction" />
      </div>

      {/* ── Charts ─────────────────────────────────────────── */}
      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-title">Carbon Saved Over Time (g CO₂)</div>
          {lineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(52,211,102,0.08)" />
                <XAxis dataKey="date" tick={{ fill: '#4d7a5e', fontSize: 11 }} />
                <YAxis tick={{ fill: '#4d7a5e', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#0f1a14', border: '1px solid rgba(52,211,102,0.3)', borderRadius: 8 }}
                  labelStyle={{ color: '#e8f5ec' }}
                  itemStyle={{ color: '#34d366' }}
                />
                <Line
                  type="monotone"
                  dataKey="saved_g"
                  stroke="#34d366"
                  strokeWidth={2}
                  dot={false}
                  name="CO₂ Saved (g)"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="loading-state" style={{ height: 220 }}>No data yet — fire some requests through the proxy!</div>
          )}
        </div>

        <div className="chart-card">
          <div className="chart-title">Model Distribution</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#0f1a14', border: '1px solid rgba(52,211,102,0.3)', borderRadius: 8 }}
                  itemStyle={{ color: '#34d366' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8fb8a0' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="loading-state" style={{ height: 220 }}>No data yet</div>
          )}
        </div>
      </div>

      {/* ── Heatmap ────────────────────────────────────────── */}
      <div className="chart-card" style={{ marginBottom: 0 }}>
        <div className="chart-title">📅 Carbon Savings Heatmap (Last 30 Days)</div>
        <CarbonHeatmap daily={daily} />
      </div>
    </div>
  )
}
