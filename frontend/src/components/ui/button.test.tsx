import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('loading disables, sets aria-busy and keeps the label', () => {
    render(<Button loading>Create test run</Button>)
    const b = screen.getByRole('button', { name: 'Create test run' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b.querySelector('svg')).not.toBeNull()
  })

  it('idle has no aria-busy and no spinner', () => {
    render(<Button>Save changes</Button>)
    const b = screen.getByRole('button', { name: 'Save changes' })
    expect(b).toBeEnabled()
    expect(b).not.toHaveAttribute('aria-busy')
    expect(b.querySelector('svg')).toBeNull()
  })

  it('disabled stays disabled without busy', () => {
    render(<Button disabled>Delete project</Button>)
    const b = screen.getByRole('button', { name: 'Delete project' })
    expect(b).toBeDisabled()
    expect(b).not.toHaveAttribute('aria-busy')
  })

  it('default variant carries the 48px phone height, outline does not', () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="outline">Other</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Primary' }).className).toContain('max-md:min-h-12')
    expect(screen.getByRole('button', { name: 'Other' }).className).not.toContain('max-md:min-h-12')
  })
})
