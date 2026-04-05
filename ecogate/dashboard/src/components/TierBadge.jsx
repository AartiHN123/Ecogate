const TIER_CONFIG = {
  small:  { label: 'Small',  className: 'badge-small' },
  medium: { label: 'Medium', className: 'badge-medium' },
  large:  { label: 'Large',  className: 'badge-large' },
  caller: { label: 'Caller', className: 'badge-bypassed' },
}

export default function TierBadge({ tier }) {
  const cfg = TIER_CONFIG[tier] ?? { label: tier ?? '—', className: 'badge-bypassed' }
  return <span className={cfg.className}>{cfg.label}</span>
}
