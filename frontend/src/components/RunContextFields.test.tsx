import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { NO_CONTEXT, RunContextFields, type RunContext } from './RunContextFields'

vi.mock('@/api/testAssets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/testAssets')>()),
  listEnvironments: () => Promise.resolve([{ id: 'e1', name: 'Staging' }]),
  listBuilds: () =>
    Promise.resolve([
      { id: 'b1', name: 'build-1', release_id: 'r1' },
      { id: 'b2', name: 'build-2', release_id: null },
    ]),
  listReleases: () => Promise.resolve([{ id: 'r1', name: 'Release 1.0' }]),
}))

function Harness({ start = NO_CONTEXT, required = false }: { start?: RunContext; required?: boolean }) {
  const [value, setValue] = useState(start)
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RunContextFields projectId="p1" value={value} onChange={setValue} required={required} />
    </QueryClientProvider>
  )
}

describe('RunContextFields', () => {
  it('marks environment and build as required only when the organization requires them', () => {
    const { unmount } = render(<Harness />)
    expect(screen.queryAllByText('*')).toHaveLength(0)
    unmount()
    render(<Harness required />)
    expect(screen.getAllByText(/required|\*/i).length).toBeGreaterThan(0)
  })

  it('takes the release from a build that belongs to one', async () => {
    render(<Harness start={{ environment_id: '', build_id: 'b1', release_id: '' }} />)
    expect(await screen.findByText('From the build.')).toBeInTheDocument()
    expect((await screen.findAllByText('Release 1.0')).length).toBeGreaterThan(0)
  })

  it('lets a build with no release leave the release to the person', async () => {
    render(<Harness start={{ environment_id: '', build_id: 'b2', release_id: '' }} />)
    await screen.findAllByRole('combobox')
    expect(screen.queryByText('From the build.')).not.toBeInTheDocument()
  })
})
