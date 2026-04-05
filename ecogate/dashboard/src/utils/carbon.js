// Carbon equivalency conversion helpers
// All inputs/outputs in grams of CO2

export const FACTORS = {
  GRAMS_PER_MILE_DRIVEN:   404,      // avg US car (gCO2/mile)
  GRAMS_PER_TREE_YEAR:     21_000,   // one tree absorbs ~21kg CO2/year
  GRAMS_PER_PHONE_CHARGE:  8.22,     // average smartphone charge
}

/**
 * Convert CO2 savings (grams) to human-readable equivalencies.
 * @param {number} savings_g  - grams CO2 saved
 * @returns {{ miles: number, treeDays: number, phones: number }}
 */
export function toEquivalencies(savings_g) {
  const g = savings_g || 0
  return {
    miles:    parseFloat((g / FACTORS.GRAMS_PER_MILE_DRIVEN).toFixed(3)),
    treeDays: parseFloat(((g / FACTORS.GRAMS_PER_TREE_YEAR) * 365).toFixed(2)),
    phones:   parseFloat((g / FACTORS.GRAMS_PER_PHONE_CHARGE).toFixed(1)),
  }
}

/**
 * Format grams for display. Small values get 4dp, larger get 2dp.
 */
export function formatCarbon(g, opts = {}) {
  if (g == null || isNaN(g)) return '—'
  const n = parseFloat(g)
  if (opts.total) return n.toFixed(2) + ' g'
  if (n < 0.01) return n.toFixed(5) + ' g'
  if (n < 1) return n.toFixed(4) + ' g'
  return n.toFixed(2) + ' g'
}

/**
 * Format a number with commas.
 */
export function formatNum(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString()
}

/**
 * Format milliseconds as a readable latency string.
 */
export function formatLatency(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Group logs by date (YYYY-MM-DD) and sum savings_g per day.
 * Returns an array sorted by date ascending.
 */
export function groupByDay(logs) {
  const map = {}
  for (const log of logs) {
    const day = log.timestamp?.slice(0, 10)
    if (!day) continue
    map[day] = (map[day] || 0) + (log.savings_g || 0)
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, savings_g]) => ({ date, savings_g }))
}
