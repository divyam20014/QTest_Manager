import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider, useToast } from '@/lib/toast'

function Trigger({ onUndo = () => {} }: { onUndo?: () => void }) {
  const { show } = useToast()
  return (
    <>
      <button onClick={() => show('success', 'Saved', { action: { label: 'Undo', onClick: onUndo } })}>ok</button>
      <button onClick={() => show('error', 'Boom')}>err</button>
    </>
  )
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polite status, does not steal focus, auto-dismisses after 4s', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    const btn = screen.getByText('ok')
    btn.focus()
    fireEvent.click(btn)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(btn).toHaveFocus()
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('Undo runs the action and dismisses', () => {
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('ok'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('errors persist until dismissed', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('err'))
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Boom')).toBeNull()
  })
})
