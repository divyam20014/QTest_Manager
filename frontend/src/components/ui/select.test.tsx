import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { Select } from '@/components/ui/select'

describe('Select (Combobox-backed)', () => {
  it('maps <option> children, reports changes as an event-like object and keeps the hidden select in sync', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Select id="sev" name="sev" value="low" onChange={onChange}>
        <option value="low">Low</option>
        <option value="high">High</option>
      </Select>,
    )
    const hidden = container.querySelector('select#sev') as HTMLSelectElement
    expect(hidden.value).toBe('low')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'High' }))
    expect(onChange.mock.calls[0][0].target).toMatchObject({ value: 'high', name: 'sev' })
  })

  it('uncontrolled: defaults to the first option and mirrors programmatic ref.value writes', () => {
    const ref = createRef<HTMLSelectElement>()
    render(
      <Select ref={ref} id="d">
        <option value="x">Ex</option>
        <option value="y">Why</option>
      </Select>,
    )
    expect(ref.current?.value).toBe('x')
    expect(screen.getByRole('combobox')).toHaveTextContent('Ex')
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Why' }))
    expect(ref.current?.value).toBe('y')
  })

  it('a blank option becomes the placeholder', () => {
    render(
      <Select id="b" value="">
        <option value="">All statuses</option>
        <option value="o">Open</option>
      </Select>,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('All statuses')
  })
  it('adopts react-hook-form default values (register ref write) without going dirty', () => {
    let dirty = true
    function F() {
      const form = useForm({ defaultValues: { p: 'Medium' } })
      dirty = form.formState.isDirty
      return (
        <Select id="p" {...form.register('p')}>
          <option>Low</option>
          <option>Medium</option>
        </Select>
      )
    }
    render(<F />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Medium')
    expect(dirty).toBe(false)
  })
})
