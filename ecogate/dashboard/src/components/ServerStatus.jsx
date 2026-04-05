import { useEffect, useState } from 'react'
import { api } from '../utils/api'

export default function ServerStatus() {
  const [status, setStatus] = useState('checking') // 'ok' | 'error' | 'checking'
  const [info, setInfo] = useState(null)

  useEffect(() => {
    let mounted = true

    async function check() {
      try {
        const data = await api.health()
        if (!mounted) return
        setStatus('ok')
        setInfo(data)
      } catch {
        if (!mounted) return
        setStatus('error')
        setInfo(null)
      }
    }

    check()
    const interval = setInterval(check, 10_000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.04)', border: '1px solid var(--color-border)' }}>
      <span
        className="relative flex h-2.5 w-2.5 flex-shrink-0"
        title={status === 'ok' ? `Server OK: ${info?.version ?? ''}` : 'Server unreachable'}
      >
        {status === 'ok' && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-eco-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            status === 'ok' ? 'bg-eco-400' : status === 'error' ? 'bg-red-400' : 'bg-yellow-400'
          }`}
        />
      </span>
      <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
        {status === 'ok' ? 'Proxy online' : status === 'error' ? 'Proxy offline' : 'Connecting…'}
      </span>
    </div>
  )
}
