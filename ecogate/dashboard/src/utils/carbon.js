/**
 * carbon.js — client-side equivalency helper
 * Mirrors server/carbon.js equivalencies() for use in the React dashboard.
 */

export function equivalencies(saved_g) {
  const saved_kg = saved_g / 1000
  return {
    trees:          +(saved_kg / (21 / 365)).toFixed(4),
    car_miles:      +(saved_kg / 0.404).toFixed(4),
    phones_charged: +(saved_kg / 0.008855).toFixed(2),
  }
}
