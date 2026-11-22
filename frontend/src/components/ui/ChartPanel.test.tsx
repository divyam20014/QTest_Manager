import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/lib/toast'
import { ChartPanel } from './ChartPanel'


const table = { columns: ['Date', 'Pass'], rows: [['2026-01-01', 3], ['2026-01-02', 5]] }

function renderPanel(props: Partial<React.ComponentProps<typeof ChartPanel>> = {}) {
  return render(
    <ToastProvider>
      <ChartPanel title="Execution Trends" table={table} {...props}>
        <svg className="recharts-surface" />
      </ChartPanel>
    </ToastProvider>,
  )
}

describe('ChartPanel actions', () => {
  const created: Blob[] = []
  const clicked: string[] = []
  beforeEach(() => {
    created.length = 0
    clicked.length = 0
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      created.push(b as Blob)
      return 'blob:test'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
  })

  it('toggles the table view with aria-pressed', async () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: 'View as table' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View as chart' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers Download CSV and PNG in the "..." menu and downloads the loaded data as CSV', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Chart actions' }))
    expect(screen.getByRole('menuitem', { name: 'Download PNG' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download CSV' }))
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatch(/^execution-trends-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(created[0].type).toContain('text/csv')
    expect(await created[0].text()).toContain('Date,Pass')
  })

  it('omits Download PNG for non-SVG charts and in the table view', async () => {
    const { unmount } = renderPanel({ png: false })
    await userEvent.click(screen.getByRole('button', { name: 'Chart actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Download PNG' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Download CSV' })).toBeInTheDocument()
    unmount()
  })

  it('shows no actions while there is no data', () => {
    renderPanel({ table: undefined })
    expect(screen.queryByRole('button', { name: /^Chart actions/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View as table' })).toBeNull()
  })
})
