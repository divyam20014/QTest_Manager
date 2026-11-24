import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { BoardColumnState } from '@/lib/board'
import { BoardView, type BoardCardData } from './BoardView'

const columns = [
  { id: 'New', label: 'New' },
  { id: 'Assigned', label: 'Assigned' },
  { id: 'Closed', label: 'Closed' },
]

function column(items: BoardCardData[], extra: Partial<BoardColumnState<BoardCardData>> = {}): BoardColumnState<BoardCardData> {
  return { items, total: items.length, loading: false, error: null, hasMore: false, loadingMore: false, loadMore: vi.fn(), retry: vi.fn(), ...extra }
}

const card = (over: Partial<BoardCardData> = {}): BoardCardData => ({
  id: 'd1',
  displayId: 'DEF-1',
  title: 'Login fails',
  href: '/defects/d1',
  levels: [{ label: 'High severity', tone: 'warning' }],
  assignee: 'Tess',
  due: { iso: '2000-01-01', overdue: true },
  targets: [
    { column: 'Assigned', label: 'Assigned' },
    { column: 'Closed', label: 'Closed', disabledReason: 'needs close permission' },
  ],
  ...over,
})

function renderBoard(props: Partial<React.ComponentProps<typeof BoardView>> = {}, items = [card()]) {
  return render(
    <MemoryRouter>
      <BoardView
        label="Defects board"
        noun="defect"
        columns={columns}
        data={{ New: column(items), Assigned: column([]), Closed: column([], { total: 12, hasMore: true }) }}
        onMove={vi.fn().mockResolvedValue('moved')}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('BoardView', () => {
  it('shows the server count of each column and a card with id, title, level, assignee and overdue date', () => {
    renderBoard()
    const board = screen.getByRole('region', { name: 'Defects board' })
    expect(within(board).getByText('DEF-1')).toBeInTheDocument()
    expect(within(board).getByRole('link', { name: 'Login fails' })).toHaveAttribute('href', '/defects/d1')
    expect(within(board).getByText('High severity')).toBeInTheDocument()
    expect(within(board).getByText('Tess')).toBeInTheDocument()
    expect(within(board).getByText(/overdue/)).toBeInTheDocument()
    // Column totals come from the server, not from the loaded cards.
    expect(screen.getByLabelText('12 in Closed')).toBeInTheDocument()
    expect(screen.getByText('Showing 0 of 12')).toBeInTheDocument()
  })

  it('moves a card from the Move to menu and announces it', async () => {
    const onMove = vi.fn().mockResolvedValue('moved')
    renderBoard({ onMove })
    fireEvent.click(screen.getByRole('button', { name: 'Move DEF-1 to…' }))
    const menu = await screen.findByRole('menu', { name: 'Move DEF-1 to' })
    expect(within(menu).getByRole('menuitem', { name: /Closed \(needs close permission\)/ })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Assigned' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), 'Assigned'))
    await waitFor(() => expect(screen.getByTestId('board-live')).toHaveTextContent('DEF-1 moved to Assigned.'))
  })

  it('shows the server refusal and keeps the card where it was', async () => {
    const onMove = vi.fn().mockRejectedValue(new Error('Resolution is required'))
    const { container } = renderBoard({ onMove })
    fireEvent.click(screen.getByRole('button', { name: 'Move DEF-1 to…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Assigned' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('DEF-1 stays in New: Resolution is required')
    expect(container.querySelector('[data-column="New"] [data-card="d1"]')).not.toBeNull()
  })

  it('moves a card by drag and drop onto an allowed column and refuses one that is not allowed', async () => {
    const onMove = vi.fn().mockResolvedValue('moved')
    const { container } = renderBoard({ onMove })
    const li = container.querySelector('[data-card="d1"]') as HTMLElement
    const assigned = container.querySelector('[data-column="Assigned"]') as HTMLElement
    const closed = container.querySelector('[data-column="Closed"]') as HTMLElement
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(li, { dataTransfer })
    fireEvent.dragOver(assigned, { dataTransfer })
    fireEvent.drop(assigned, { dataTransfer })
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), 'Assigned'))
    onMove.mockClear()
    fireEvent.dragStart(li, { dataTransfer })
    fireEvent.drop(closed, { dataTransfer })
    expect(await screen.findByRole('alert')).toHaveTextContent('needs close permission')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('gives read-only cards no drag handle and no Move to menu', () => {
    renderBoard({ onMove: undefined })
    expect(screen.queryByTestId('drag-handle')).toBeNull()
    expect(screen.queryByRole('button', { name: /Move DEF-1/ })).toBeNull()
  })

  it('offers Load more for a column with more records and shows the read-only explanation', () => {
    const loadMore = vi.fn()
    renderBoard({
      onMove: undefined,
      note: 'Status is derived.',
      data: { New: column([card({ targets: [] })], { total: 40, hasMore: true, loadMore }), Assigned: column([]), Closed: column([]) },
    })
    expect(screen.getByText('Status is derived.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(loadMore).toHaveBeenCalled()
  })

  it('shows a column error with a retry', () => {
    const retry = vi.fn()
    renderBoard({ data: { New: column([], { error: new Error('x'), retry }), Assigned: column([]), Closed: column([]) } })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })
})
