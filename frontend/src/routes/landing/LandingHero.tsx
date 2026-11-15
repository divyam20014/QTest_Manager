import { ArrowRight, CheckCircle2, Eye, Gauge, Layers } from 'lucide-react'
import { Link } from 'react-router-dom'

import { SectionLink } from './shared'

const VALUE_PROPS = [
  { icon: Eye, label: 'Complete QA Visibility' },
  { icon: Layers, label: 'Intelligent Test Management' },
  { icon: Gauge, label: 'Data-Driven Quality Decisions' },
]

export function LandingHero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-container grid grid-cols-1 items-center gap-14 pb-20 pt-14 sm:pt-20 lg:grid-cols-[1.12fr_1fr] lg:gap-12 lg:pb-28 lg:pt-24">
        <div>
          <p className="lp-pill">
            <span className="lp-live-dot" aria-hidden="true" />
            Enterprise QA Test Management Platform
          </p>
          <h1 id="lp-hero-title" className="lp-h1 mt-6">
            <span className="sm:whitespace-nowrap">Quality Engineering.</span>
            <br />
            <span className="lp-gradient-text">Simplified. Intelligent. Connected.</span>
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--lp-on-dark-2)] sm:text-lg">
            Take control of your entire QA lifecycle with one unified platform. Manage requirements, test
            cases, test execution, defects, and quality insights with complete visibility and control.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SectionLink to="platform" className="lp-btn lp-btn-primary">
              Explore Platform
              <ArrowRight className="lp-arrow size-4" aria-hidden="true" />
            </SectionLink>
            <Link to="/login" className="lp-btn lp-btn-ghost-dark">
              Sign In
            </Link>
          </div>
          <ul className="mt-10 grid gap-3 sm:grid-cols-3 sm:gap-4">
            {VALUE_PROPS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm font-medium text-[var(--lp-on-dark)]">
                <span className="lp-icon lp-icon-sm shrink-0">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <DashboardPreview />
      </div>
    </section>
  )
}

const TREND = [71, 74, 72, 77, 80, 78, 83, 85, 84, 88, 90, 92]

function trendPath(width: number, height: number) {
  const min = 60
  const max = 100
  const step = width / (TREND.length - 1)
  const points = TREND.map((v, i) => [i * step, height - ((v - min) / (max - min)) * height] as const)
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, last: points[points.length - 1] }
}

const METRICS = [
  { label: 'Total Test Cases', value: '1,248', note: '+36 this week', tone: 'text-[var(--lp-on-dark-3)]' },
  { label: 'Passed Tests', value: '962', note: '86.4% pass rate', tone: 'text-emerald-300' },
  { label: 'Failed Tests', value: '74', note: '−12 vs last cycle', tone: 'text-rose-300' },
  { label: 'Open Defects', value: '31', note: '4 critical', tone: 'text-amber-300' },
]

const DEFECTS = [
  { label: 'Critical', value: 4, color: '#f43f5e' },
  { label: 'High', value: 9, color: '#f59e0b' },
  { label: 'Medium', value: 12, color: '#6366f1' },
  { label: 'Low', value: 6, color: '#38bdf8' },
]

const ACTIVITY = [
  { who: 'QA Engineer', what: 'executed TC-1042 · Policy issuance', status: 'Passed', tone: 'text-emerald-300' },
  { who: 'QA Lead', what: 'approved 8 test cases in Claims', status: 'Approved', tone: 'text-sky-300' },
  { who: 'QA Engineer', what: 'logged DEF-318 · Premium rounding', status: 'High', tone: 'text-amber-300' },
]

function DashboardPreview() {
  const { line, area, last } = trendPath(300, 84)
  const maxDefect = Math.max(...DEFECTS.map((d) => d.value))
  return (
    <div className="lp-float relative">
      <figure
        className="lp-preview overflow-hidden"
        aria-label="Illustrative preview of the QTestHub dashboard using sample data"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <i className="block size-2.5 rounded-full bg-white/15" />
            <i className="block size-2.5 rounded-full bg-white/15" />
            <i className="block size-2.5 rounded-full bg-white/15" />
          </div>
          <span className="truncate text-xs font-medium text-[var(--lp-on-dark-2)]">Quality Dashboard · Release 4.2</span>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--lp-on-dark-2)]">
            Illustrative data
          </span>
        </div>

        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {METRICS.map((m) => (
              <div key={m.label} className="lp-tile p-3">
                <p className="text-[11px] font-medium text-[var(--lp-on-dark-2)]">{m.label}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-white">{m.value}</p>
                <p className={`mt-0.5 text-[11px] ${m.tone}`}>{m.note}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.45fr_1fr]">
            <div className="lp-tile p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium text-[var(--lp-on-dark-2)]">Pass rate · last 12 cycles</p>
                <p className="text-xs font-semibold text-emerald-300">92%</p>
              </div>
              <svg viewBox="0 0 300 84" className="mt-3 h-24 w-full" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="lp-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#6366f1" stopOpacity="0.45" />
                    <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[21, 42, 63].map((y) => (
                  <line key={y} x1="0" x2="300" y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                ))}
                <path d={area} fill="url(#lp-area)" />
                <path
                  d={line}
                  className="lp-line-draw"
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={last[0] - 3} cy={last[1]} r="3.5" fill="#c7d2fe" />
              </svg>
            </div>

            <div className="lp-tile flex flex-col items-center justify-center gap-2 p-3">
              <p className="self-start text-xs font-medium text-[var(--lp-on-dark-2)]">Quality score</p>
              <QualityRing value={88} />
              <p className="text-[11px] text-[var(--lp-on-dark-3)]">Execution progress 86%</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="lp-tile p-3">
              <p className="text-xs font-medium text-[var(--lp-on-dark-2)]">Execution summary</p>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
                <span className="lp-bar-grow h-full bg-emerald-400" style={{ width: '77%' }} />
                <span className="lp-bar-grow h-full bg-rose-400" style={{ width: '6%', animationDelay: '120ms' }} />
                <span className="lp-bar-grow h-full bg-amber-400" style={{ width: '3%', animationDelay: '200ms' }} />
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-[var(--lp-on-dark-2)]">
                <li><span className="mr-1.5 inline-block size-2 rounded-full bg-emerald-400" />Passed 962</li>
                <li><span className="mr-1.5 inline-block size-2 rounded-full bg-rose-400" />Failed 74</li>
                <li><span className="mr-1.5 inline-block size-2 rounded-full bg-amber-400" />Blocked 38</li>
                <li><span className="mr-1.5 inline-block size-2 rounded-full bg-white/20" />Not run 174</li>
              </ul>
            </div>
            <div className="lp-tile p-3">
              <p className="text-xs font-medium text-[var(--lp-on-dark-2)]">Open defects by severity</p>
              <ul className="mt-3 grid gap-1.5">
                {DEFECTS.map((d, i) => (
                  <li key={d.label} className="grid grid-cols-[52px_1fr_18px] items-center gap-2 text-[11px] text-[var(--lp-on-dark-2)]">
                    {d.label}
                    <span className="h-1.5 rounded-full bg-white/5">
                      <span
                        className="lp-bar-grow block h-full rounded-full"
                        style={{ width: `${(d.value / maxDefect) * 100}%`, background: d.color, animationDelay: `${i * 90}ms` }}
                      />
                    </span>
                    <span className="text-right text-white">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="lp-tile hidden p-3 sm:block">
            <p className="text-xs font-medium text-[var(--lp-on-dark-2)]">Recent activity</p>
            <ul className="mt-2 divide-y divide-white/5">
              {ACTIVITY.map((a) => (
                <li key={a.what} className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
                  <span className="truncate text-[var(--lp-on-dark-2)]">
                    <span className="font-medium text-white">{a.who}</span> {a.what}
                  </span>
                  <span className={`shrink-0 font-semibold ${a.tone}`}>{a.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </figure>
      <p className="mt-3 text-center text-xs text-[var(--lp-on-dark-3)]">
        <CheckCircle2 className="mr-1 inline size-3.5 align-[-2px]" aria-hidden="true" />
        Sample data for illustration, not real metrics.
      </p>
    </div>
  )
}

function QualityRing({ value }: { value: number }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 80 80" className="size-20" aria-hidden="true">
      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        stroke="url(#lp-ring)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform="rotate(-90 40 40)"
      />
      <defs>
        <linearGradient id="lp-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <text x="40" y="45" textAnchor="middle" fontSize="17" fontWeight="700" fill="#fff">
        {value}
      </text>
    </svg>
  )
}
