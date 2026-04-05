import { useEffect, useRef, useState } from 'react'

function useCountUp(target, duration = 1000) {
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
 * @param {string} props.icon        - Emoji or SVG
 * @param {string} props.label
 * @param {number} props.value       - Numeric value to animate
 * @param {string} props.unit
 * @param {string} props.description - Explanation text
 * @param {function} [props.format]
 */
export default function EquivalencyCard({ icon, label, value, unit, description, format }) {
  const animated = useCountUp(value, 1200)
  const display = format
    ? format(animated)
    : animated.toLocaleString(undefined, { maximumFractionDigits: 2 })

  return (
    <div
      className="glass-card p-5 flex flex-col gap-4 hover:scale-[1.02] transition-transform duration-200"
    >
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      </div>

      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight" style={{ color: 'var(--color-accent)' }}>
            {display}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{unit}</span>
        </div>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
        {description}
      </p>
    </div>
  )
}
