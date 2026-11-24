import { GripVertical, MoveRight } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { type BoardColumnSpec, type BoardColumnState } from '@/lib/board'
import { dueRelative, formatDueDate } from '@/lib/dueDate'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { LevelBadge } from '@/components/ui/LevelBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ADR-124. A board lays the same records out in columns of one field. This component is the shared,
// presentational part: it knows nothing about defects or runs. The page gives it the columns' data
// (lib/board.ts), which cards may move where (`targets`), and what a move does (`onMove`: the real
// endpoint; it throws with the server's message when the move is refused, and the card stays put).
//
// Moving works three ways, none needing a pointer: native HTML5 drag and drop, a "Move to" menu on
// every movable card (also the touch path), and both announce the outcome in a polite live region.

export interface BoardTarget {
  column: string
  label: string
  /** Shown instead of moving; the entry is disabled. */
  disabledReason?: string
}

export interface BoardCardData {
  id: string
  displayId?: string | null
  title: string
  href: string
  /** Level badges (severity, priority): a dot plus a label, never colour alone. */
  levels?: { label: string; tone: BadgeTone }[]
  badges?: { label: string; tone?: BadgeTone }[]
  /** A name; `null` reads "Unassigned"; leave it out when the record has no assignee concept. */
  assignee?: string | null
  /** A calendar date (YYYY-MM-DD) and whether it is past due. */
  due?: { iso: string; overdue: boolean } | null
  /** One extra muted line (project, age). */
  meta?: string | null
  /** Columns this card may be moved to. Empty or missing: not movable (no handle, no menu). */
  targets?: BoardTarget[]
}

export type MoveOutcome = 'moved' | 'deferred'

export function BoardView({
  label,
  columns,
  data,
  noun,
  onMove,
  explainBlocked,
  note,
  emptyText,
}: {
  label: string
  columns: readonly BoardColumnSpec[]
  data: Record<string, BoardColumnState<BoardCardData>>
  /** "defect" / "test run": used in announcements. */
  noun: string
  /**
   * Performs the move. Resolve `moved` once the server accepted it, `deferred` when the move needs
   * more input first (a dialog took over); throw an Error with the server's message to refuse.
   */
  onMove?: (card: BoardCardData, toColumn: string) => Promise<MoveOutcome>
  /** Why a drop on `toColumn` is not possible for this card (drag path; the menu only lists real targets). */
  explainBlocked?: (card: BoardCardData, toColumn: string) => string
  /** Always-visible explanation (e.g. why the columns cannot take drops). */
  note?: ReactNode
  emptyText?: (column: BoardColumnSpec) => string
}) {
  const uid = useId()
  const [drag, setDrag] = useState<{ card: BoardCardData; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ id: string; to: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const columnLabel = (id: string) => columns.find((c) => c.id === id)?.label ?? id
  // The live region is cleared and refilled so a repeated identical message is still read out.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function announce(message: string) {
    setAnnouncement('')
    if (announceTimer.current) clearTimeout(announceTimer.current)
    announceTimer.current = setTimeout(() => setAnnouncement(message), 30)
  }

  async function move(card: BoardCardData, from: string, to: string) {
    if (!onMove || from === to) return
    const name = card.displayId ?? card.title
    const target = card.targets?.find((t) => t.column === to)
    if (!target || target.disabledReason) {
      const why = target?.disabledReason ?? explainBlocked?.(card, to) ?? `${name} cannot be moved to ${columnLabel(to)}.`
      setFailure(why)
      announce(why)
      return
    }
    setFailure(null)
    setMoving({ id: card.id, to })
    try {
      const outcome = await onMove(card, to)
      if (outcome === 'moved') announce(`${name} moved to ${columnLabel(to)}.`)
      else announce(`Choose the details to move ${name} to ${columnLabel(to)}.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The move was refused.'
      setFailure(`${name} stays in ${columnLabel(from)}: ${message}`)
      announce(`${name} was not moved. ${message}`)
    } finally {
      setMoving(null)
    }
  }

  const canDropOn = (column: string) => {
    if (!drag || drag.from === column) return false
    const target = drag.card.targets?.find((t) => t.column === column)
    return !!target && !target.disabledReason
  }

  return (
    <section aria-label={label} className="flex flex-col gap-2" data-testid="board">
      {note && <p className="text-xs text-[var(--muted-foreground)]">{note}</p>}
      {failure && (
        <p role="alert" className="rounded-md border border-[var(--status-serious)] bg-[var(--status-serious-bg)] px-3 py-2 text-sm text-[var(--status-serious)]">
          {failure}
        </p>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2 max-md:-mx-4 max-md:snap-x max-md:snap-mandatory max-md:px-4">
        {columns.map((column) => {
          const state = data[column.id]
          const headingId = `${uid}-${column.id}`
          const dropping = over === column.id && canDropOn(column.id)
          return (
            <section
              key={column.id}
              aria-labelledby={headingId}
              data-column={column.id}
              onDragOver={(e) => {
                // Every other column accepts the drop so a refused one can say why (a browser never fires
                // `drop` on a target that did not accept it); only an allowed one is highlighted.
                if (drag && drag.from !== column.id) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (over !== column.id) setOver(column.id)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === column.id) setOver(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const dragged = drag
                setDrag(null)
                if (dragged) void move(dragged.card, dragged.from, column.id)
              }}
              className={cn(
                'flex w-72 shrink-0 flex-col max-md:snap-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2 max-md:w-[82vw]',
                drag && canDropOn(column.id) && 'border-dashed border-[var(--ring)]',
                drag && !canDropOn(column.id) && drag.from !== column.id && 'opacity-60',
                dropping && 'bg-[var(--accent)]',
              )}
            >
              <header className="flex flex-col gap-0.5 px-1 pt-0.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 id={headingId} className="text-sm font-semibold">
                    {column.label}
                  </h2>
                  <Badge tone="neutral" aria-label={state?.total === undefined ? 'Counting' : `${state.total} in ${column.label}`}>
                    {state?.total ?? '...'}
                  </Badge>
                </div>
                {column.hint && <p className="text-xs text-[var(--muted-foreground)]">{column.hint}</p>}
              </header>

              {state?.error ? (
                <div className="flex flex-col items-start gap-2 rounded-md bg-[var(--card)] p-3 text-sm">
                  <p className="text-[var(--status-serious)]">Could not load {column.label}.</p>
                  <Button size="sm" variant="outline" onClick={state.retry}>
                    Try again
                  </Button>
                </div>
              ) : state?.loading ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : state && state.items.length === 0 ? (
                <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
                  {emptyText?.(column) ?? `No ${noun}s here.`}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {(state?.items ?? []).map((card) => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      noun={noun}
                      pendingTo={moving?.id === card.id ? columnLabel(moving.to) : null}
                      dragging={drag?.card.id === card.id}
                      canMove={!!onMove && (card.targets?.length ?? 0) > 0}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', card.displayId ?? card.title)
                        setDrag({ card, from: column.id })
                        setFailure(null)
                      }}
                      onDragEnd={() => {
                        setDrag(null)
                        setOver(null)
                      }}
                      onMenuMove={(to) => void move(card, column.id, to)}
                    />
                  ))}
                </ul>
              )}

              {state && (state.hasMore || state.loadingMore) && (
                <div className="flex flex-col items-center gap-1 px-1 pb-1">
                  <Button size="sm" variant="outline" className="w-full max-md:min-h-11" loading={state.loadingMore} onClick={state.loadMore}>
                    Load more
                  </Button>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Showing {state.items.length} of {state.total}
                  </p>
                </div>
              )}
            </section>
          )
        })}
      </div>
      <div role="status" aria-live="polite" className="sr-only" data-testid="board-live">
        {announcement}
      </div>
    </section>
  )
}

function BoardCard({
  card,
  noun,
  pendingTo,
  dragging,
  canMove,
  onDragStart,
  onDragEnd,
  onMenuMove,
}: {
  card: BoardCardData
  noun: string
  pendingTo: string | null
  dragging: boolean
  canMove: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onMenuMove: (to: string) => void
}) {
  const name = card.displayId ?? card.title
  return (
    <li
      draggable={canMove && !pendingTo}
      onDragStart={canMove ? onDragStart : undefined}
      onDragEnd={canMove ? onDragEnd : undefined}
      aria-busy={pendingTo ? true : undefined}
      data-card={card.id}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] p-2.5 text-sm shadow-sm transition-opacity motion-reduce:transition-none',
        canMove && 'cursor-grab active:cursor-grabbing',
        (dragging || pendingTo) && 'opacity-50',
      )}
    >
      <div className="flex items-start gap-1.5">
        {canMove && <GripVertical className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" data-testid="drag-handle" />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {card.displayId && <span className="font-mono text-xs text-[var(--muted-foreground)]">{card.displayId}</span>}
          <Link
            to={card.href}
            draggable={false}
            className="break-words font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] max-md:py-1"
          >
            {card.title}
          </Link>
        </div>
        {canMove && (
          <DropdownMenu
            label={`Move ${name} to`}
            fixed
            items={(card.targets ?? []).map((t) => ({
              label: t.disabledReason ? `${t.label} (${t.disabledReason})` : t.label,
              disabled: !!t.disabledReason,
              icon: <MoveRight className="size-4" aria-hidden="true" />,
              onSelect: () => onMenuMove(t.column),
            }))}
            trigger={(props) => (
              <IconButton {...props} size="sm" aria-label={`Move ${name} to…`} disabled={!!pendingTo} tooltipAlign="end">
                <MoveRight aria-hidden="true" />
              </IconButton>
            )}
          />
        )}
      </div>
      {(card.levels?.length || card.badges?.length) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {card.levels?.map((l) => (
            <LevelBadge key={l.label} tone={l.tone}>
              {l.label}
            </LevelBadge>
          ))}
          {card.badges?.map((b) => (
            <Badge key={b.label} tone={b.tone ?? 'neutral'}>
              {b.label}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-[var(--muted-foreground)]">
        {card.assignee !== undefined ? <span>{card.assignee ?? 'Unassigned'}</span> : <span />}
        {card.due && (
          <span className={cn(card.due.overdue && 'font-medium text-[var(--status-serious)]')}>
            {card.due.overdue ? dueRelative(card.due.iso) : `Due ${formatDueDate(card.due.iso)}`}
          </span>
        )}
      </div>
      {card.meta && <p className="text-xs text-[var(--muted-foreground)]">{card.meta}</p>}
      {pendingTo && (
        <p className="text-xs font-medium" role="status">
          Moving {noun} to {pendingTo}…
        </p>
      )}
    </li>
  )
}
