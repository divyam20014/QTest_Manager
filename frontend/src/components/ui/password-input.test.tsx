import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FormField } from '@/components/ui/form-field'
import { PasswordInput, PasswordStrengthMeter } from '@/components/ui/password-input'

describe('PasswordInput', () => {
  it('toggles type and aria-pressed, keeping autocomplete', () => {
    render(<PasswordInput aria-label="pw" autoComplete="new-password" />)
    const input = screen.getByLabelText('pw')
    fireEvent.click(screen.getByRole('button', { name: 'Show characters' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('button', { name: 'Show characters' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('meter reports a text label', () => {
    render(<PasswordStrengthMeter value="abc" />)
    expect(screen.getByRole('status')).toHaveTextContent('Too short')
  })
})

describe('FormField error wiring', () => {
  it('links the error with aria-describedby and aria-invalid', () => {
    render(
      <FormField id="n" label="Name" error="Name is required">
        {(f) => <input {...f} />}
      </FormField>,
    )
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe('n-error')
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
  })
})
