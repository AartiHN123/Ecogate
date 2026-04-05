import { useEffect, useRef, useState } from 'react'

function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    if (target == null || isNaN(target)) return
    const start = prev.current
    const end = parseFloat(target)
    prev.current = end

    if (start === end) return

    const startTime = performance.now()
    let raf

    function step(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(start + (end - start) * eased)
      if (progress < 1) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {string} [props.unit]
 * @param {string} [props.subtext]
 * @param {React.ReactNode} [props.icon]
 * @param {string} [props.trend]   '+12%' or '-5%'
 * @param {function} [props.format]  custom formatter
 * @param {boolean} [props.integer]
 */
export default function StatCard({ label, value, unit, subtext, icon, trend, format, integer = false }) {
  const animated = useCountUp(value)
  const display = format
    ? format(animated)
    : integer
      ? Math.round(animated).toLocaleString()
      : animated.toLocaleString(undefined, { maximumFractionDigits: 2 })

  const trendPositive = trend?.startsWith('+')

  return (
    <div className="glass-card p-5 flex flex-col gap-3 animate-slide-up">
      <div className="flex items-start justify-between">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="flex-shrink-0 p-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.1)' }}>
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <span className="stat-value count-animate">{display}</span>
        {unit && (
          <span className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            {unit}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between">
        {subtext && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {subtext}
          </span>
        )}
        {trend && (
          <span className={`text-xs font-semibold ${trendPositive ? 'text-eco-400' : 'text-red-400'}`}>
            {trend}
          </span>
        )}
      </div>
    </div>
  )
}
