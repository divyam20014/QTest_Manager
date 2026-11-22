import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState, ErrorState } from '@/components/ui/empty-state'

describe('EmptyState', () => {
  it('defaults to the empty variant and shows the single action', () => {
    const { container } = render(<EmptyState title="No things yet" action={<button>Create thing</button>} />)
    expect(screen.getByText('No things yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create thing' })).toBeInTheDocument()
    expect(container.querySelector('[data-state="empty"]')).not.toBeNull()
  })

  it('filtered variant is marked and renders no action when none is passed', () => {
    const { container } = render(<EmptyState variant="filtered" title="No matches" />)
    expect(container.querySelector('[data-state="filtered"]')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ErrorState', () => {
  it('keeps the server reason and calls onRetry', () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Server said no" onRetry={onRetry} />)
    expect(screen.getByText('Server said no')).toBeInTheDocument()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(onRetry).toHaveBeenCalled()
  })
})
