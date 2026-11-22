import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'

const OPTS: ComboboxOption[] = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Blueberry', disabled: true },
  { value: 'd', label: 'Cherry' },
]

function Harness({ options = OPTS, ...rest }: Partial<React.ComponentProps<typeof Combobox>>) {
  const [v, setV] = useState('')
  return (
    <>
      <Label htmlFor="fruit">Fruit</Label>
      <Combobox id="fruit" name="fruit" value={v} onChange={setV} options={options} {...rest} />
      <output data-testid="val">{v}</output>
    </>
  )
}

const trigger = () => screen.getByRole('combobox', { name: 'Fruit' })

describe('Combobox', () => {
  it('has combobox/listbox semantics and is named by its label', () => {
    render(<Harness />)
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('navigates with arrows (skipping disabled), Enter selects, Esc closes and refocuses', () => {
    render(<Harness />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' }) // opens on Apple
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' }) // Banana
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' }) // skips Blueberry -> Cherry
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(screen.getByTestId('val')).toHaveTextContent('d')
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
  })

  it('Home/End and type-ahead move the active option', () => {
    render(<Harness />)
    fireEvent.keyDown(trigger(), { key: 'End' })
    expect(screen.getByRole('option', { name: 'Cherry' }).className).toContain('bg-[var(--muted)]')
    fireEvent.keyDown(trigger(), { key: 'Home' })
    expect(screen.getByRole('option', { name: 'Apple' }).className).toContain('bg-[var(--muted)]')
    fireEvent.keyDown(trigger(), { key: 'c' })
    expect(screen.getByRole('option', { name: 'Cherry' }).className).toContain('bg-[var(--muted)]')
  })

  it('does not select disabled options', () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Blueberry' }))
    expect(screen.getByTestId('val')).toHaveTextContent('')
  })

  it('shows a search box only above 8 options and filters', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ value: `v${i}`, label: `Item ${i}` }))
    const { unmount } = render(<Harness />)
    fireEvent.click(trigger())
    expect(screen.queryByLabelText('Search options')).toBeNull()
    unmount()
    render(<Harness options={many} />)
    fireEvent.click(trigger())
    fireEvent.change(screen.getByLabelText('Search options'), { target: { value: 'item 7' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('Search options'), { key: 'Enter' })
    expect(screen.getByTestId('val')).toHaveTextContent('v7')
  })

  it('clearable resets to empty', () => {
    render(<Harness clearable />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Banana' }))
    expect(screen.getByTestId('val')).toHaveTextContent('b')
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByTestId('val')).toHaveTextContent('')
  })

  it('disabled does not open; error sets aria-invalid', () => {
    render(<Harness disabled error />)
    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveAttribute('aria-invalid', 'true')
  })

  it('exposes a hidden native select with the same id for selectOption-style tests', () => {
    const { container } = render(<Harness />)
    const native = container.querySelector('select#fruit') as HTMLSelectElement
    expect(native).not.toBeNull()
    expect(native.name).toBe('fruit')
    fireEvent.change(native, { target: { value: 'b' } })
    expect(screen.getByTestId('val')).toHaveTextContent('b')
    expect(trigger()).toHaveTextContent('Banana')
    native.focus()
    expect(trigger()).toHaveFocus()
  })
})
