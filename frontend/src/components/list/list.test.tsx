import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { FilterChips } from './FilterChips'
import { ListToolbar } from './ListToolbar'
import { RowDetailDrawer, type RowDetailConfig } from './RowDetailDrawer'
import { rowDetailProps, snippet } from './rowDetail'
import { buildStatusTabs } from './statusTabs'

describe('FilterChips', () => {
  const chips = [
    { key: 'projectId', label: 'Project', value: 'Alpha' },
    { key: 'severity', label: 'Severity', value: 'High' },
  ]

  it('renders nothing without chips', () => {
    const { container } = render(<FilterChips chips={[]} onRemove={() => {}} onClearAll={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('removes one chip by its key and clears all', () => {
    const onRemove = vi.fn()
    const onClearAll = vi.fn()
    render(<FilterChips chips={chips} onRemove={onRemove} onClearAll={onClearAll} />)
    expect(screen.getByText('Project: Alpha')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Severity filter' }))
    expect(onRemove).toHaveBeenCalledWith('severity')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })
})

describe('ListToolbar', () => {
  function toolbar(activeCount: number, onClear = () => {}) {
    return (
      <ListToolbar
        search={{ id: 's', value: '', onChange: () => {}, placeholder: 'Search…' }}
        activeCount={activeCount}
        onClearFilters={onClear}
        chips={[]}
        onRemoveChip={() => {}}
        filters={<label>Project filter<select aria-label="Project filter" /></label>}
      />
    )
  }

  it('shows the active filter count on the Filters button', () => {
    const { rerender } = render(toolbar(0))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    rerender(toolbar(3))
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('3')
    expect(screen.getByLabelText('3 active')).toBeInTheDocument()
  })

  it('opens the filter panel, closes on Escape and returns focus to the button', () => {
    render(toolbar(1))
    const button = screen.getByRole('button', { name: /Filters/ })
    fireEvent.click(button)
    const panel = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(panel).getByLabelText('Project filter')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? panel, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('clears filters from the panel', () => {
    const onClear = vi.fn()
    render(toolbar(2, onClear))
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalled()
  })
})

interface Row {
  id: string
  title: string
  status: string
  description: string | null
}

const config: RowDetailConfig<Row> = {
  entity: 'defect',
  title: (r) => r.title,
  badges: (r) => <span>{r.status}</span>,
  fields: (r) => [
    { label: 'ID', value: r.id },
    { label: 'Assignee', value: null },
  ],
  description: (r) => r.description,
  href: (r) => `/defects/${r.id}`,
}

describe('RowDetailDrawer', () => {
  const row: Row = { id: 'd1', title: 'Crash on save', status: 'Open', description: 'It crashes\nwhen saving.' }

  it('stays closed without a row', () => {
    render(
      <MemoryRouter>
        <RowDetailDrawer row={null} onClose={() => {}} config={config} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the configured fields, description and the full page link', () => {
    render(
      <MemoryRouter>
        <RowDetailDrawer row={row} onClose={() => {}} config={config} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Crash on save' })
    expect(within(dialog).getByText('Open')).toBeInTheDocument()
    expect(within(dialog).getByText('ID')).toBeInTheDocument()
    expect(within(dialog).getByText('d1')).toBeInTheDocument()
    // an empty value shows a dash, not nothing
    expect(within(dialog).getByText('—')).toBeInTheDocument()
    expect(within(dialog).getByText(/It crashes/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/defects/d1')
  })

  it('trims long descriptions', () => {
    expect(snippet('a'.repeat(400)).length).toBeLessThanOrEqual(281)
    expect(snippet('short  text')).toBe('short text')
  })
})

describe('rowDetailProps', () => {
  function Table({ onOpen }: { onOpen: () => void }) {
    return (
      <table>
        <tbody>
          <tr {...rowDetailProps(onOpen)} data-testid="row">
            <td>
              <input type="checkbox" aria-label="select" />
              <a href="/x">Title link</a>
              <span>plain</span>
            </td>
          </tr>
        </tbody>
      </table>
    )
  }

  it('opens on a click on the row but not on a link or checkbox', () => {
    const onOpen = vi.fn()
    render(<Table onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('link', { name: 'Title link' }))
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('plain'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('opens on Enter when the row itself is focused, not from a child', () => {
    const onOpen = vi.fn()
    render(<Table onOpen={onOpen} />)
    const rowEl = screen.getByTestId('row')
    expect(rowEl).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(screen.getByRole('link', { name: 'Title link' }), { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(rowEl, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('buildStatusTabs', () => {
  it('maps counts onto the status order with an All total', () => {
    const tabs = buildStatusTabs({
      order: ['New', 'Open'],
      counts: { New: 4, Open: 1 },
      total: 5,
      ready: true,
    })
    expect(tabs).toEqual([
      { key: '', label: 'All', count: 5 },
      { key: 'New', label: 'New', count: 4 },
      { key: 'Open', label: 'Open', count: 1 },
    ])
  })

  it('uses 0 for a status the server did not return, labels, and no counts until ready', () => {
    const ready = buildStatusTabs({
      order: ['draft', 'approved'],
      counts: { draft: 2 },
      total: 2,
      ready: true,
      labels: { draft: 'Draft', approved: 'Approved' },
    })
    expect(ready.map((t) => [t.label, t.count])).toEqual([
      ['All', 2],
      ['Draft', 2],
      ['Approved', 0],
    ])
    const loading = buildStatusTabs({ order: ['draft'], counts: {}, total: undefined, ready: false })
    expect(loading.every((t) => t.count === undefined)).toBe(true)
  })
})
