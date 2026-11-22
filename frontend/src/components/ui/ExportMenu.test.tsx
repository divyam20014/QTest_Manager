import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/lib/toast'
import { ExportMenu } from './ExportMenu'

describe('ExportMenu', () => {
  it('lists the export formats and runs a non-file item', async () => {
    const print = vi.fn()
    render(
      <ToastProvider>
        <ExportMenu
          menuLabel="Export compliance report"
          items={[
            { label: 'PDF', path: '/a.pdf', fallbackName: 'a.pdf' },
            { label: 'CSV', path: '/a.csv', fallbackName: 'a.csv' },
            { label: 'Excel', path: '/a.xlsx', fallbackName: 'a.xlsx' },
            { label: 'Print', onSelect: print },
          ]}
        />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['PDF', 'CSV', 'Excel', 'Print'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Print' }))
    expect(print).toHaveBeenCalled()
  })

  it('disables the trigger when asked', () => {
    render(
      <ToastProvider>
        <ExportMenu menuLabel="x" items={[]} disabled />
      </ToastProvider>,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })
})
