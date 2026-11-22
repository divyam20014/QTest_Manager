import { fireEvent, render, screen } from '@testing-library/react'
import { MoreHorizontal } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { Dialog } from '@/components/ui/dialog'
import { DropdownMenu } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'

function Menu({ onDelete = () => {} }: { onDelete?: () => void }) {
  return (
    <DropdownMenu
      label="Row actions"
      trigger={(p) => (
        <IconButton aria-label="Actions" {...p}>
          <MoreHorizontal />
        </IconButton>
      )}
      items={[
        { label: 'Edit', onSelect: () => {}, shortcut: 'E' },
        { label: 'Archive', onSelect: () => {}, disabled: true },
        { type: 'separator' },
        { label: 'Delete', onSelect: onDelete, destructive: true },
      ]}
    />
  )
}

describe('DropdownMenu', () => {
  it('opens with role=menu, focuses first item, arrows rove (skipping disabled)', () => {
    render(<Menu />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' })
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toHaveFocus()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('Esc closes and returns focus to the trigger', () => {
    render(<Menu />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('Enter activates the focused item and closes; destructive item is styled', () => {
    const onDelete = vi.fn()
    render(<Menu onDelete={onDelete} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowUp' })
    const del = screen.getByRole('menuitem', { name: 'Delete' })
    expect(del).toHaveFocus()
    expect(del.className).toContain('text-[var(--destructive)]')
    fireEvent.keyDown(del, { key: 'Enter' })
    expect(onDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape inside a Dialog closes only the menu', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Dlg">
        <Menu />
      </Dialog>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Edit/ }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
