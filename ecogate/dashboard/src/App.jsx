import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Logs      from './pages/Logs'
import Settings  from './pages/Settings'

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>🌿 EcoGate</h1>
        <span>Carbon Diet for AI Inference</span>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/"        className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')} end>
          <span className="nav-icon">📊</span> Dashboard
        </NavLink>
        <NavLink to="/logs"    className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <span className="nav-icon">📋</span> Request Logs
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
          <span className="nav-icon">⚙️</span> Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="status-indicator">
          <div className="status-dot" />
          Proxy connected
        </div>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/logs"     element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
