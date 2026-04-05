import { useMemo, useState } from 'react'

const WEEKS = 52
const DAYS = 7
const CELL = 13
const GAP = 2
const STEP = CELL + GAP
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function colorFor(value, max) {
  if (!value || max === 0) return 'rgba(74,222,128,0.06)'
  const t = Math.min(value / max, 1)
  if (t < 0.15) return 'rgba(74,222,128,0.15)'
  if (t < 0.35) return 'rgba(74,222,128,0.32)'
  if (t < 0.55) return 'rgba(74,222,128,0.52)'
  if (t < 0.75) return 'rgba(74,222,128,0.72)'
  return 'rgba(74,222,128,0.92)'
}

/**
 * @param {{ data: Array<{date: string, savings_g: number}> }} props
 */
export default function CarbonHeatmap({ data = [] }) {
  const [tip, setTip] = useState(null)

  const { grid, maxVal, monthLabels } = useMemo(() => {
    const map = {}
    let maxVal = 0
    for (const { date, savings_g } of data) {
      map[date] = (map[date] || 0) + savings_g
      if (map[date] > maxVal) maxVal = map[date]
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Start: 52 weeks back, snapped to Sunday
    const start = new Date(today)
    start.setDate(start.getDate() - WEEKS * 7)
    start.setDate(start.getDate() - start.getDay())

    const grid = []
    const monthLabels = []
    let lastMonth = -1

    for (let w = 0; w < WEEKS; w++) {
      const week = []
      for (let d = 0; d < DAYS; d++) {
        const dt = new Date(start)
        dt.setDate(start.getDate() + w * 7 + d)
        const iso = dt.toISOString().slice(0, 10)
        week.push({ date: iso, value: map[iso] || 0, future: dt > today })

        if (d === 0 && dt.getMonth() !== lastMonth) {
          monthLabels.push({ col: w, label: MONTHS[dt.getMonth()] })
          lastMonth = dt.getMonth()
        }
      }
      grid.push(week)
    }

    return { grid, maxVal, monthLabels }
  }, [data])

  const svgW = WEEKS * STEP + 32
  const svgH = DAYS * STEP + 22

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Carbon Savings Heatmap
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Last 52 weeks — darker = more CO₂ saved
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <span>Less</span>
          {[0.06, 0.18, 0.36, 0.58, 0.88].map((a, i) => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 2, background: `rgba(74,222,128,${a})`, flexShrink: 0 }} />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="relative" style={{ minWidth: svgW }}>
          <svg width={svgW} height={svgH} style={{ display: 'block' }}>
            {/* Month labels */}
            {monthLabels.map(({ col, label }) => (
              <text key={`${col}${label}`} x={32 + col * STEP} y={10} fontSize={10} fill="var(--color-text-muted)">{label}</text>
            ))}

            {/* Day labels (Mon, Wed, Fri only) */}
            {[{ d: 1, y: 1 }, { d: 3, y: 3 }, { d: 5, y: 5 }].map(({ d, y }) => (
              <text key={d} x={2} y={18 + y * STEP} fontSize={9} fill="var(--color-text-muted)">
                {['Mon','Wed','Fri'][d === 1 ? 0 : d === 3 ? 1 : 2]}
              </text>
            ))}

            {/* Cells */}
            <g transform="translate(30, 14)">
              {grid.map((week, w) =>
                week.map((cell, d) =>
                  cell.future ? null : (
                    <rect
                      key={cell.date}
                      x={w * STEP}
                      y={d * STEP}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      fill={colorFor(cell.value, maxVal)}
                      onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, ...cell })}
                      onMouseLeave={() => setTip(null)}
                      style={{ cursor: 'default' }}
                    />
                  )
                )
              )}
            </g>
          </svg>

          {/* Tooltip */}
          {tip && (
            <div
              className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg text-xs shadow-xl"
              style={{
                left: tip.x + 12,
                top: tip.y - 44,
                background: 'rgba(10,15,13,0.97)',
                border: '1px solid var(--color-border-hover)',
                color: 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
              }}
            >
              <div className="font-semibold mb-0.5">{tip.date}</div>
              <div style={{ color: 'var(--color-accent)' }}>
                {tip.value > 0 ? `${tip.value.toFixed(4)}g CO₂ saved` : 'No activity'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
