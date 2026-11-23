import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { StepBuilder } from '@/components/StepBuilder'
import { newStep, type BuilderStep } from '@/lib/stepBuilder'
import { ToastProvider } from '@/lib/toast'

function Harness({ initial }: { initial: BuilderStep[] }) {
  const [steps, setSteps] = useState(initial)
  return (
    <ToastProvider>
      <StepBuilder steps={steps} onChange={setSteps} />
      <output data-testid="actions">{steps.map((s) => s.action).join('|')}</output>
    </ToastProvider>
  )
}

const three = () => ['alpha', 'beta', 'gamma'].map((action) => newStep({ action, expected: `${action} ok` }))
const order = () => screen.getByTestId('actions').textContent

describe('StepBuilder', () => {
  it('numbers rows by position and adds a step with the Add button', () => {
    render(<Harness initial={three()} />)
    expect(screen.getByText('Step 1')).toBeInTheDocument()
    expect(screen.getByText('Step 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add step/i }))
    expect(screen.getByText('Step 4')).toBeInTheDocument()
    expect(order()).toBe('alpha|beta|gamma|')
  })

  it('reorders with the Move up / Move down buttons and renumbers', () => {
    render(<Harness initial={three()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }))
    expect(order()).toBe('alpha|gamma|beta')
    fireEvent.click(screen.getByRole('button', { name: 'Move step 1 down' }))
    expect(order()).toBe('gamma|alpha|beta')
    // The first row cannot move up, the last cannot move down.
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move step 3 down' })).toBeDisabled()
  })

  it('reorders from the keyboard on the drag handle (Arrow Up / Arrow Down)', () => {
    render(<Harness initial={three()} />)
    const handle = screen.getByRole('button', { name: /Reorder step 2/ })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(order()).toBe('beta|alpha|gamma')
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder step 2/ }), { key: 'ArrowDown' })
    expect(order()).toBe('beta|gamma|alpha')
  })

  it('removes a step and offers Undo, which restores it in place', () => {
    render(<Harness initial={three()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }))
    expect(order()).toBe('alpha|gamma')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(order()).toBe('alpha|beta|gamma')
  })

  it('the last remaining step cannot be removed', () => {
    render(<Harness initial={[newStep()]} />)
    expect(screen.getByRole('button', { name: 'Remove step 1' })).toBeDisabled()
  })

  it('edits a step in place without changing the sequence', () => {
    render(<Harness initial={three()} />)
    fireEvent.change(screen.getAllByLabelText(/^Action/)[1], { target: { value: 'BETA2' } })
    expect(order()).toBe('alpha|BETA2|gamma')
  })

  it('shows the required message for an empty expected result after the field is left', () => {
    render(<Harness initial={[newStep({ action: 'do it' })]} />)
    expect(screen.queryByText(/Expected result is required/)).toBeNull()
    fireEvent.blur(screen.getAllByLabelText(/^Expected result/)[0])
    expect(screen.getByRole('alert')).toHaveTextContent('Step 1: Expected result is required')
  })

  it('pasting several lines into an Action creates a step per line', () => {
    render(<Harness initial={[newStep()]} />)
    fireEvent.paste(screen.getAllByLabelText(/^Action/)[0], {
      clipboardData: { getData: () => '1. open\n2. click\n3. check' },
    })
    expect(order()).toBe('open|click|check')
  })
})

describe('StepBuilder with the defect field set (reproduction steps)', () => {
  function DefectHarness({ initial }: { initial: BuilderStep[] }) {
    const [steps, setSteps] = useState(initial)
    return (
      <ToastProvider>
        <StepBuilder steps={steps} onChange={setSteps} fields="defect" label="Steps to Reproduce" />
        <output data-testid="actions">{steps.map((s) => s.action).join('|')}</output>
      </ToastProvider>
    )
  }

  it('offers a step and an optional expected result, no test data, and marks the list required', () => {
    render(<DefectHarness initial={[newStep()]} />)
    expect(screen.getByText('Steps to Reproduce')).toBeInTheDocument()
    expect(screen.getAllByText('(required)', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/^Step/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/Test data/)).toBeNull()
    fireEvent.blur(screen.getAllByLabelText(/^Expected result/)[0])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('flags the step that failed in an execution', () => {
    render(<DefectHarness initial={[newStep({ action: 'open' }), newStep({ action: 'submit', failed: true })]} />)
    expect(screen.getByText('Failed here')).toBeInTheDocument()
  })

  it('numbers, reorders and removes like the test case builder', () => {
    render(<DefectHarness initial={['a', 'b', 'c'].map((action) => newStep({ action }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move step 3 up' }))
    expect(screen.getByTestId('actions').textContent).toBe('a|c|b')
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 1' }))
    expect(screen.getByTestId('actions').textContent).toBe('c|b')
  })
})
