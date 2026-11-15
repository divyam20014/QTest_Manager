import { useId } from 'react'

import { cn } from '@/lib/utils'

export interface GaugeDialProps {
  /** 0-100 */
  value: number
  label: string
  /** Optional formatted value shown in the dial center, e.g. "87%". Defaults to `${value}%`. Keep it short. */
  valueLabel?: string
  /** Secondary text (e.g. "5 of 7 steps") rendered below the dial, never inside the arc. */
  detail?: string
  className?: string
}

/**
 * Rotary dial/gauge for a single 0-100 metric (pass rate, coverage %,
 * release readiness). Pure SVG, no chart library -- distinct from the
 * Recharts-based trend charts elsewhere in the app, which stay on
 * Recharts. Scales via viewBox (no fixed px width) so it shrinks
 * cleanly in a narrow card at phone width; the metric is also exposed
 * as text so nothing is lost if the SVG doesn't render.
 */
export function GaugeDial({ value, label, valueLabel, detail, className }: GaugeDialProps) {
  const clamped = Math.min(100, Math.max(0, value))
  const gradientId = useId()

  // Dial sweeps 270 degrees, starting at -135deg (bottom-left) through
  // +135deg (bottom-right), so 0 and 100 both read near the bottom --
  // the common analog-gauge convention.
  const startAngle = -135
  const sweep = 270
  const angle = startAngle + (clamped / 100) * sweep

  const size = 160
  const cx = size / 2
  const cy = size / 2
  const r = 58
  const trackWidth = 14

  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) }
  }

  const describeArc = (fromDeg: number, toDeg: number) => {
    const from = toXY(fromDeg)
    const to = toXY(toDeg)
    const largeArc = toDeg - fromDeg > 180 ? 1 : 0
    return `M ${from.x} ${from.y} A ${r} ${r} 0 ${largeArc} 1 ${to.x} ${to.y}`
  }

  const needleTip = toXY(angle)
  // Short tail only -- a full-radius tail sweeps through the value text near 50%.
  const tailRad = ((angle + 180) * Math.PI) / 180
  const needleBase = { x: cx + 12 * Math.sin(tailRad), y: cy - 12 * Math.cos(tailRad) }

  // The gap between the arc's two ends fits ~5 glyphs at 22px; shrink longer labels to fit.
  const centerText = valueLabel ?? `${Math.round(clamped)}%`
  const fontSize = centerText.length <= 5 ? 22 : Math.max(12, Math.floor((22 * 5) / centerText.length))

  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[160px]" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--status-good)" />
          </linearGradient>
        </defs>

        {/* Pressed/inset track -- the dial's "well" the needle sweeps over. */}
        <path
          d={describeArc(startAngle, startAngle + sweep)}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={trackWidth}
          strokeLinecap="round"
          opacity={0.25}
        />
        {/* Filled progress arc. */}
        <path
          d={describeArc(startAngle, angle)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={trackWidth}
          strokeLinecap="round"
        />

        {/* Raised center hub + needle, giving the tactile knob look. */}
        <line
          x1={needleBase.x}
          y1={needleBase.y}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={0.85}
        />
        <circle cx={cx} cy={cy} r={10} fill="var(--tactile-surface-raised)" stroke="var(--border)" strokeWidth={1} />

        {/* Sits in the open gap between the arc's ends, below where the needle
            can reach even at 0% or 100%. */}
        <text
          x={cx}
          y={cy + r - 4}
          textAnchor="middle"
          fontSize={fontSize}
          className="fill-[var(--foreground)] font-semibold"
        >
          {centerText}
        </text>
      </svg>
      <span className="text-sm font-medium text-[var(--muted-foreground)]">{label}</span>
      {detail && <span className="text-xs text-[var(--muted-foreground)]">{detail}</span>}
    </div>
  )
}
