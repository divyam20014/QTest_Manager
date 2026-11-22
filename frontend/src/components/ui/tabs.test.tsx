import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { LinkTabs, Tabs } from '@/components/ui/tabs'

describe('Tabs', () => {
  const items = [
    { key: 'a', label: 'Alpha', content: <p>A body</p>, count: 3 },
    { key: 'b', label: 'Beta', content: <p>B body</p> },
    { key: 'c', label: 'Gamma', content: <p>C body</p> },
  ]

  it('has tablist, arrow/Home/End navigation, and count badges', () => {
    render(<Tabs items={items} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveTextContent('3')
    fireEvent.keyDown(screen.getByRole('tab', { name: /Alpha/ }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('B body')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Gamma' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('LinkTabs', () => {
  it('renders router links, marks the current one, shows counts', () => {
    render(
      <MemoryRouter initialEntries={['/x/two']}>
        <LinkTabs
          label="Sections"
          items={[
            { label: 'One', to: '/x/one' },
            { label: 'Two', to: '/x/two', count: 5 },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument()
    const two = screen.getByRole('link', { name: /Two/ })
    expect(two).toHaveAttribute('aria-current', 'page')
    expect(two).toHaveTextContent('5')
    expect(screen.getByRole('link', { name: 'One' })).not.toHaveAttribute('aria-current')
  })
})
