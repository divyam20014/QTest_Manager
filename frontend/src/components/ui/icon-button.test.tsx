import { render, screen } from '@testing-library/react'
import { X } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { IconButton } from '@/components/ui/icon-button'

describe('IconButton', () => {
  it('is named by aria-label, shows it as a tooltip, and is type=button', () => {
    render(
      <IconButton aria-label="Close panel">
        <X />
      </IconButton>,
    )
    const b = screen.getByRole('button', { name: 'Close panel' })
    expect(b).toHaveAttribute('type', 'button')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close panel')
  })

  it('sizes and variants', () => {
    render(
      <IconButton aria-label="Small" size="sm" variant="secondary">
        <X />
      </IconButton>,
    )
    const b = screen.getByRole('button', { name: 'Small' })
    expect(b.className).toContain('size-8')
    expect(b.className).toContain('border')
  })

  it('requires aria-label at the type level', () => {
    // @ts-expect-error aria-label is required
    const el = <IconButton>x</IconButton>
    expect(el).toBeTruthy()
  })
})
