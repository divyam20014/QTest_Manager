import { useEffect, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle, Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { GaugeDial } from '@/components/ui/GaugeDial'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/pagination'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/tabs'
import { TactileButton } from '@/components/ui/TactileButton'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip } from '@/components/ui/tooltip'
import { useToast } from '@/lib/toast'

/**
 * Living design-system catalogue (docs/DESIGN_SYSTEM.md). DEV-ONLY: App.tsx
 * registers it at /_design-system only when import.meta.env.DEV, so it is
 * absent from production builds. Every section renders the real shared
 * component or token, so this page is also a quick visual regression check
 * in both themes.
 */

const COLOUR_TOKENS = [
  ['--background', 'Page'],
  ['--foreground', 'Text'],
  ['--muted', 'Muted surface'],
  ['--muted-foreground', 'Secondary text'],
  ['--border', 'Border'],
  ['--primary', 'Primary (ink)'],
  ['--brand', 'Brand / accent'],
  ['--brand-muted', 'Brand tint'],
  ['--link', 'Link text'],
  ['--destructive', 'Destructive'],
  ['--ring', 'Focus ring'],
  ['--tactile-surface', 'Tactile surface'],
  ['--tactile-surface-raised', 'Tactile raised'],
  ['--sidebar-bg', 'Sidebar'],
] as const

const STATUS_TOKENS = [
  ['good', 'Success'],
  ['warning', 'Warning'],
  ['serious', 'Error'],
  ['info', 'Information'],
  ['critical', 'Critical'],
  ['neutral', 'Neutral'],
] as const

const CHART_TOKENS = [
  '--chart-grid',
  '--chart-axis-text',
  '--chart-axis-line',
  '--chart-tooltip-bg',
  '--chart-tooltip-border',
] as const

const TYPE_SCALE = [
  ['qth-type-page-title', 'Page title — Test Repository'],
  ['qth-type-section-title', 'Section title — Release readiness'],
  ['qth-type-card-heading', 'Card heading — Pass rate'],
  ['qth-type-body', 'Body — The suite ran 214 cases against build 7.4.2.'],
  ['qth-type-label', 'Label — Assignee'],
  ['qth-type-helper', 'Helper — Shown to everyone on the project.'],
  ['qth-type-table-head', 'Table header — Status'],
  ['qth-type-table-value', 'Table value — In Progress'],
  ['qth-type-overline', 'Overline — Administration'],
] as const

const RADII = [
  ['--radius-control', 'Control'],
  ['--radius-card', 'Card'],
  ['--radius-panel', 'Panel'],
  ['--radius-sheet', 'Sheet'],
  ['--radius-pill', 'Pill'],
] as const

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="qth-type-section-title">{title}</h2>
        {note && <p className="qth-type-helper">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export default function DesignPreview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [page, setPage] = useState(2)
  const { show } = useToast()

  // The theme tokens are scoped to :root[data-theme], so the attribute must go
  // on the document root; restored on unmount so it doesn't leak.
  useEffect(() => {
    const prev = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', theme)
    return () => {
      if (prev) document.documentElement.setAttribute('data-theme', prev)
      else document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <div className="min-h-screen bg-[var(--background)] p-4 text-[var(--foreground)] md:p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <PageHeader
          title="QTestHub design system"
          description="Living catalogue of tokens and shared components. Dev-only; see docs/DESIGN_SYSTEM.md."
          actions={
            <Button variant="outline" size="sm" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
              Theme: {theme}
            </Button>
          }
        />

        <Section title="Colour" note="Semantic tokens only. Never hard-code a hex value in a screen.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {COLOUR_TOKENS.map(([token, label]) => (
              <div key={token} className="flex flex-col gap-1">
                <div className="h-12 rounded-[var(--radius-control)] border border-[var(--border)]" style={{ background: `var(${token})` }} />
                <p className="text-xs font-medium">{label}</p>
                <p className="font-mono text-[11px] text-[var(--muted-foreground)]">{token}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STATUS_TOKENS.map(([key, label]) => (
              <div
                key={key}
                className="flex h-12 items-center justify-center rounded-[var(--radius-control)] text-xs font-medium"
                style={{ background: `var(--status-${key}-bg)`, color: `var(--status-${key})` }}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {CHART_TOKENS.map((token) => (
              <div key={token} className="flex items-center gap-2 text-xs">
                <span className="size-5 rounded border border-[var(--border)]" style={{ background: `var(${token})` }} />
                <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{token}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" note="Use the .qth-type-* classes (or the Tailwind equivalents in index.css).">
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] p-4">
            {TYPE_SCALE.map(([cls, sample]) => (
              <p key={cls} className={cls}>
                {sample}
              </p>
            ))}
          </div>
        </Section>

        <Section title="Radius and elevation">
          <div className="flex flex-wrap gap-4">
            {RADII.map(([token, label]) => (
              <div
                key={token}
                className="flex h-16 w-24 items-center justify-center border border-[var(--border)] text-xs"
                style={{ borderRadius: `var(${token})` }}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-6 rounded-[var(--radius-panel)] bg-[var(--tactile-surface)] p-6">
            <div className="qth-raised-sm flex h-16 w-24 items-center justify-center rounded-lg text-xs">raised-sm</div>
            <div className="qth-raised-md flex h-16 w-24 items-center justify-center rounded-lg text-xs">raised-md</div>
            <div className="qth-raised-lg flex h-16 w-24 items-center justify-center rounded-lg text-xs">raised-lg</div>
            <div className="qth-pressed-sm flex h-16 w-24 items-center justify-center rounded-lg text-xs">pressed-sm</div>
            <div className="qth-pressed-md flex h-16 w-24 items-center justify-center rounded-lg text-xs">pressed-md</div>
          </div>
        </Section>

        <Section title="Buttons" note="One primary action per view, rightmost. Outline = secondary, ghost = tertiary.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="outline">Secondary</Button>
            <Button variant="ghost">Tertiary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <Button size="icon" variant="outline" aria-label="Example icon button">
              ✎
            </Button>
            <TactileButton>Tactile (hero only)</TactileButton>
          </div>
        </Section>

        <Section title="Badges and status" note="Badge = plain label. StatusBadge = a state (adds an icon so colour is never the only signal).">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Neutral</Badge>
            <Badge tone="positive">Positive</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="critical">Critical</Badge>
            <Badge tone="info">Info</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge>Draft</StatusBadge>
            <StatusBadge tone="positive">Passed</StatusBadge>
            <StatusBadge tone="warning">At risk</StatusBadge>
            <StatusBadge tone="critical">Failed</StatusBadge>
            <StatusBadge tone="info">In review</StatusBadge>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid max-w-xl gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Title <span className="font-normal text-[var(--muted-foreground)]">Required</span>
              <Input placeholder="Checkout – guest user" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Priority
              <Select defaultValue="Medium">
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Notes
              <Textarea rows={3} placeholder="Steps, expected result…" />
            </label>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Card</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="qth-type-body text-[var(--muted-foreground)]">Flat card for dense list and form screens.</p>
              </CardContent>
            </Card>
            <EmbossedCard>
              <CardHeader>
                <CardTitle>EmbossedCard</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="qth-type-body text-[var(--muted-foreground)]">Raised tactile surface, reserved for Dashboard hero widgets.</p>
              </CardContent>
            </EmbossedCard>
            <EmbossedCard className="flex items-center justify-center p-6">
              <GaugeDial value={87} label="Pass rate" detail="174 of 200 passed" />
            </EmbossedCard>
          </div>
        </Section>

        <Section title="Tabs, pagination, tooltip">
          <Tabs
            items={[
              { key: 'a', label: 'Overview', content: <p className="qth-type-body">Overview content.</p> },
              { key: 'b', label: 'Activity', content: <p className="qth-type-body">Activity content.</p> },
            ]}
          />
          <Pagination page={page} totalPages={7} total={163} noun="project" onPageChange={setPage} />
          <div className="flex gap-4">
            <Tooltip content="Keyboard and hover accessible">
              <Button variant="outline" size="sm">
                Hover or focus me
              </Button>
            </Tooltip>
          </div>
        </Section>

        <Section title="Loading, empty and error states">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border)] p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--border)]">
              <EmptyState title="No defects yet" description="Defects logged during execution appear here." />
            </div>
            <div className="rounded-[var(--radius-card)] border border-[var(--border)]">
              <ErrorState onRetry={() => show('info', 'Retrying…')} />
            </div>
          </div>
        </Section>

        <Section title="Dialogs and feedback">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              Open confirm dialog
            </Button>
            <Button variant="outline" onClick={() => show('success', 'Saved')}>
              Success toast
            </Button>
            <Button variant="outline" onClick={() => show('error', 'Could not save')}>
              Error toast
            </Button>
            <Button variant="outline" onClick={() => show('warning', 'Run is paused')}>
              Warning toast
            </Button>
            <Button variant="outline" onClick={() => show('info', 'Sync scheduled')}>
              Info toast
            </Button>
          </div>
        </Section>
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Example dialog">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-[var(--muted-foreground)]">Bottom sheet below 768px, centred panel above.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(false)}>
              Save
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete project?"
        description="This removes the project and its test data."
        confirmLabel="Delete project"
        destructive
        requireText="Meridian Auto"
        onConfirm={() => {
          setConfirmOpen(false)
          show('success', 'Deleted (demo only)')
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}
