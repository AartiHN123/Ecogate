import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import ServerStatus from './components/ServerStatus'

function LeafIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
    </svg>
  )
}

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    to: '/logs',
    label: 'Logs',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.07 4.93l-1.41 1.41M12 2v2M4.93 4.93l1.41 1.41M2 12h2M4.93 19.07l1.41-1.41M12 20v2M19.07 19.07l-1.41-1.41M20 12h2"/>
      </svg>
    ),
  },
]

export default function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('ecogate-theme')
    return saved !== 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', dark)
    root.classList.toggle('light', !dark)
    localStorage.setItem('ecogate-theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg-base)' }}>
        {/* Sidebar */}
        <aside
          className="flex flex-col w-56 flex-shrink-0 border-r"
          style={{
            background: 'var(--color-bg-surface)',
            borderColor: 'var(--color-border)',
          }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-4 py-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <div className="p-1.5 rounded-lg glow-green" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>
              <LeafIcon size={18} />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>EcoGate</span>
              <p className="text-xs leading-tight" style={{ color: 'var(--color-text-muted)' }}>Carbon Proxy</p>
            </div>
          </div>

          {/* Nav links */}
          <nav className="flex flex-col gap-1 p-3 flex-1">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-3 flex flex-col gap-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <ServerStatus />
            <button
              className="btn-ghost w-full justify-center text-xs"
              onClick={() => setDark(d => !d)}
            >
              {dark ? '☀️ Light mode' : '🌙 Dark mode'}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
