import { useEffect, useState, useCallback } from 'react'
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts'
import { api } from '../utils/api'
import { toEquivalencies, formatCarbon, formatNum, formatLatency, groupByDay } from '../utils/carbon'
import StatCard from '../components/StatCard'
import EquivalencyCard from '../components/EquivalencyCard'
import CarbonHeatmap from '../components/CarbonHeatmap'
import ProviderBadge from '../components/ProviderBadge'
import TierBadge from '../components/TierBadge'

const TIER_COLORS = { small: '#4ade80', medium: '#fbbf24', large: '#f87171', caller: '#94a3b8' }
const PROVIDER_COLORS = ['#4ade80', '#a855f7', '#3b82f6', '#fb923c', '#eab308', '#ec4899', '#6366f1']

function EmptyState({ label }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 gap-3">
      <span className="text-4xl opacity-30">🌿</span>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 rounded-xl text-xs shadow-xl" style={{ background: 'rgba(10,15,13,0.97)', border: '1px solid rgba(74,222,128,0.3)' }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [logs, setLogs] = useState([])
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([api.stats(), api.logs(500)])
      setStats(s)
      setLogs(l)
      setError(null)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const totals = stats?.totals ?? {}
  const breakdown = stats?.breakdown ?? []
  const equiv = toEquivalencies(totals.total_savings_g || 0)
  const dailyData = groupByDay(logs)

  // Pie chart data: tier distribution from logs
  const tierDist = logs.reduce((acc, l) => {
    const t = l.routing_tier || 'unknown'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})
  const pieData = Object.entries(tierDist).map(([name, value]) => ({ name, value }))

  // Bar chart: carbon actual vs baseline per provider
  const providerBar = breakdown.reduce((acc, row) => {
    const existing = acc.find(r => r.provider === row.provider)
    if (existing) {
      existing.carbon_g += row.carbon_g || 0
      existing.baseline_carbon_g += row.baseline_carbon_g || 0
    } else {
      acc.push({ provider: row.provider, carbon_g: row.carbon_g || 0, baseline_carbon_g: row.baseline_carbon_g || 0 })
    }
    return acc
  }, [])

  // Line chart: savings over time
  const lineData = dailyData.slice(-30).map(d => ({
    date: d.date.slice(5), // MM-DD
    saved: parseFloat(d.savings_g.toFixed(4)),
  }))

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            🌿 Carbon Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Real-time AI inference carbon tracking
            {lastUpdated && (
              <span className="ml-2">· Updated {lastUpdated.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        {error && (
          <div className="px-3 py-2 rounded-lg text-sm" style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Requests"
          value={totals.total_requests || 0}
          integer
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
          subtext="All time"
        />
        <StatCard
          label="Carbon Saved"
          value={parseFloat((totals.total_savings_g || 0).toFixed(2))}
          unit="g CO₂"
          format={(v) => v.toFixed(2)}
          subtext={`${totals.savings_pct ?? 0}% vs baseline`}
          trend={totals.savings_pct ? `+${totals.savings_pct}%` : null}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="m9 12 2 2 4-4"/></svg>}
        />
        <StatCard
          label="Avg Latency"
          value={Math.round(totals.avg_latency_ms || 0)}
          unit="ms"
          integer
          format={(v) => Math.round(v).toLocaleString()}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
          subtext="Per request"
        />
        <StatCard
          label="Total Tokens"
          value={(totals.total_tokens_in || 0) + (totals.total_tokens_out || 0)}
          integer
          format={(v) => {
            const n = Math.round(v)
            return n >= 1000 ? `${(n/1000).toFixed(1)}K` : n.toLocaleString()
          }}
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>}
          subtext={`↑${formatNum(totals.total_tokens_in || 0)} in / ↓${formatNum(totals.total_tokens_out || 0)} out`}
        />
      </div>

      {/* Equivalency Cards */}
      <div>
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>
          Environmental Impact
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <EquivalencyCard
            icon="🚗"
            label="Miles Not Driven"
            value={equiv.miles}
            unit="miles"
            format={(v) => v.toFixed(3)}
            description="Equivalent CO₂ not emitted by an average US car"
          />
          <EquivalencyCard
            icon="🌲"
            label="Tree Days"
            value={equiv.treeDays}
            unit="tree-days"
            format={(v) => v.toFixed(2)}
            description="How many days one tree works to absorb this CO₂"
          />
          <EquivalencyCard
            icon="📱"
            label="Phones Charged"
            value={equiv.phones}
            unit="charges"
            format={(v) => v.toFixed(1)}
            description="Equivalent smartphone full charges powered"
          />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pie: Tier Distribution */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Routing Tier Distribution</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>% of requests per model tier</p>
          {pieData.length === 0 ? <EmptyState label="No requests yet" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={TIER_COLORS[entry.name] || '#94a3b8'} />
                  ))}
                </Pie>
                <ReTooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {pieData.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {pieData.map(({ name, value }) => (
                <div key={name} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLORS[name] || '#94a3b8' }} />
                  <TierBadge tier={name} />
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bar: Carbon actual vs baseline per provider */}
        <div className="glass-card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Carbon: Actual vs Baseline</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>gCO₂ per provider — green = actual, grey = would-have-been</p>
          {providerBar.length === 0 ? <EmptyState label="No data yet" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={providerBar} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="provider" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} width={45} />
                <ReTooltip content={<CustomTooltip />} />
                <Bar dataKey="baseline_carbon_g" name="Baseline" fill="rgba(148,163,184,0.3)" radius={[3,3,0,0]} />
                <Bar dataKey="carbon_g" name="Actual" fill="rgba(74,222,128,0.7)" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Line chart: savings over time */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Carbon Savings Over Time</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Daily CO₂ saved — last 30 days</p>
        {lineData.length === 0 ? <EmptyState label="No historical data yet" /> : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={lineData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <ReTooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="saved"
                name="Saved (g)"
                stroke="#4ade80"
                strokeWidth={2}
                dot={{ fill: '#4ade80', r: 3 }}
                activeDot={{ r: 5, fill: '#4ade80' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Heatmap */}
      <CarbonHeatmap data={dailyData} />
    </div>
  )
}
