import { useState } from 'react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { chartTooltipStyle, longDay, shortDay } from '@/routes/dashboardFormat'

// The Recharts-backed pieces of the Dashboard live here so the heavy chart
// library is a separate, lazily loaded chunk: the headline gauge, KPI tiles and
// activity list render first, and the charts stream in below them.

export interface StatusSlice {
  key: string
  status: string
  count: number
  color: string
}

export interface TrendPoint {
  date: string
  pass_count: number
  fail_count: number
}

export function StatusDonutChart({ data, reduceMotion }: { data: StatusSlice[]; reduceMotion: boolean }) {
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null)
  const statusPieData = data
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <defs>
          {statusPieData.map((entry, i) => (
            // Radial highlight toward the top-left, matching the
            // app-wide emboss light-source convention -- gives
            // slices a domed look without introducing any hue
            // outside the validated categorical palette.
            <radialGradient key={entry.key} id={`pie-grad-${i}`} cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
              <stop offset="100%" stopColor={entry.color} stopOpacity={0.78} />
            </radialGradient>
          ))}
        </defs>
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(value, name) => [`${value} test case${value === 1 ? '' : 's'}`, name]}
        />
        <Pie
          data={statusPieData}
          dataKey="count"
          nameKey="status"
          innerRadius="58%"
          outerRadius="92%"
          paddingAngle={2}
          cornerRadius={3}
          stroke="var(--tactile-surface)"
          strokeWidth={2}
          isAnimationActive={!reduceMotion}
          animationDuration={500}
          onMouseEnter={(_, i) => setActivePieIndex(i)}
          onMouseLeave={() => setActivePieIndex(null)}
        >
          {statusPieData.map((entry, i) => (
            <Cell
              key={entry.key}
              fill={`url(#pie-grad-${i})`}
              style={{
                filter: activePieIndex === i ? 'drop-shadow(0 4px 7px rgba(0, 0, 0, 0.35))' : undefined,
                transition: 'filter 150ms ease-out',
              }}
            />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
}

export function TrendLineChart({
  points,
  passColor,
  failColor,
  reduceMotion,
}: {
  points: TrendPoint[]
  passColor: string
  failColor: string
  reduceMotion: boolean
}) {
  const trendPoints = points
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={trendPoints} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="date"
          minTickGap={32}
          tickFormatter={shortDay}
          tick={{ fontSize: 10, fill: 'var(--chart-axis-text)' }}
          axisLine={{ stroke: 'var(--chart-axis-line)' }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 10, fill: 'var(--chart-axis-text)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          labelFormatter={(label) => longDay(String(label))}
          cursor={{ stroke: 'var(--chart-axis-line)', strokeWidth: 1 }}
        />
        <Line
          type="monotone"
          dataKey="pass_count"
          name="Pass"
          stroke={passColor}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2, style: { filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))' } }}
          isAnimationActive={!reduceMotion}
          animationDuration={500}
        />
        <Line
          type="monotone"
          dataKey="fail_count"
          name="Fail"
          stroke={failColor}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, strokeWidth: 2, style: { filter: 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3))' } }}
          isAnimationActive={!reduceMotion}
          animationDuration={500}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
