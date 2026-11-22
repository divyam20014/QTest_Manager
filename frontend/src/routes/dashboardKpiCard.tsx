import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { kpiAriaLabel, TREND_ARROW, type Trend } from '@/routes/dashboardKpi'

const TONE_CLASS = {
  good: 'text-[var(--status-good)]',
  bad: 'text-[var(--status-serious)]',
  neutral: 'text-[var(--muted-foreground)]',
} as const

/** Compact progress ring for the pass-rate KPI. Decorative: the value is in the card's name. */
function PassRing({ percent }: { percent: number }) {
  const r = 15
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <svg viewBox="0 0 36 36" className="size-10 shrink-0 -rotate-90" aria-hidden="true" focusable="false">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--muted)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--status-good)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * c} ${c}`}
      />
    </svg>
  )
}

/**
 * One KPI: big tabular number, small label, trend (arrow + text, so colour is never
 * the only signal). The whole card is one link; the aria-label carries value + trend.
 */
export function KpiCard({
  label,
  value,
  trend,
  href,
  ringPercent,
  index = 0,
}: {
  label: string
  value: string
  trend: Trend
  href: string
  /** Pass-rate only: 0-100 fills the ring; omit for no ring. */
  ringPercent?: number
  index?: number
}) {
  const Icon = trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus
  return (
    <EmbossedCard
      interactive
      className="qth-animate-in relative h-full min-h-[104px] p-4"
      style={{ animation: `qth-slide-in 0.25s ease-out ${index * 30}ms backwards` }}
      data-testid="kpi-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={href}
            aria-label={kpiAriaLabel(label, value, trend)}
            className="text-xs font-medium text-[var(--muted-foreground)] after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--ring)]"
          >
            {label}
          </Link>
          <p className="text-3xl font-semibold leading-none tabular-nums" aria-hidden="true">
            {value}
          </p>
        </div>
        {ringPercent !== undefined && <PassRing percent={ringPercent} />}
      </div>
      <p className={cn('mt-3 flex items-center gap-1 text-xs', TONE_CLASS[trend.tone])} aria-hidden="true">
        <Icon className="size-3.5" />
        <span>
          {TREND_ARROW[trend.direction]} {trend.text}
        </span>
      </p>
    </EmbossedCard>
  )
}

export function KpiCardSkeleton() {
  return (
    <EmbossedCard className="min-h-[104px] p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-3 h-3 w-24" />
    </EmbossedCard>
  )
}
