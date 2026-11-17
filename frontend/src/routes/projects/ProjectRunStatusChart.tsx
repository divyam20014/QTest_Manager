import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { chartTooltipStyle } from '@/routes/dashboardFormat'

// Recharts-backed part of the project drilldown, kept in its own file so the
// chart library loads lazily (only when a project page is actually opened).

export interface RunStatusBar {
  key: string
  label: string
  count: number
  color: string
}

export function ProjectRunStatusChart({ data, reduceMotion }: { data: RunStatusBar[]; reduceMotion: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: 'var(--chart-axis-line)' }}
          tick={{ fill: 'var(--chart-axis-text)', fontSize: 11 }}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          width={32}
          tick={{ fill: 'var(--chart-axis-text)', fontSize: 11 }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          contentStyle={chartTooltipStyle}
          formatter={(value) => [`${value} test case${value === 1 ? '' : 's'} in runs`, 'Count']}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion} animationDuration={500}>
          {data.map((entry) => (
            <Cell key={entry.key} fill={entry.color} />
          ))}
          <LabelList dataKey="count" position="top" style={{ fill: 'var(--foreground)', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
