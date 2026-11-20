import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ToastProvider } from '@/lib/toast'
import { ExportButton } from './ExportButton'

function renderButton(props: Partial<React.ComponentProps<typeof ExportButton>> = {}) {
  return render(
    <ToastProvider>
      <ExportButton path="/x" fallbackName="x.xlsx" {...props} />
    </ToastProvider>,
  )
}

describe('ExportButton accessible name', () => {
  it('is the visible label when there is no context', () => {
    renderButton()
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeInTheDocument()
  })

  it('adds the context after the visible label so the name contains the visible text (WCAG 2.5.3)', () => {
    renderButton({ ariaLabel: 'test cases' })
    const button = screen.getByRole('button', { name: 'Export Excel (test cases)' })
    expect(button.textContent).toContain('Export Excel')
    expect(button.getAttribute('aria-label')).toContain(button.textContent ?? '')
  })
})
