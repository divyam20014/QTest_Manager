// ADR-139: only the name is required; blank details are sent as null.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProjectForm, type ProjectFormValues } from './ProjectForm'

const blank: ProjectFormValues = {
  name: '',
  domain: '',
  priority: 'Medium',
  status: 'On Track',
  manager_name: '',
  manager_user_id: '',
  start_date: '',
  end_date: '',
  budget: '',
  region: '',
}

function setup(over: Partial<ProjectFormValues> = {}, domains: string[] = ['Fintech']) {
  const onSubmit = vi.fn()
  const { container } = render(
    <ProjectForm
      inDialog
      defaultValues={{ ...blank, ...over }}
      domains={domains}
      submitLabel="Create Project"
      isSubmitting={false}
      onSubmit={onSubmit}
    />,
  )
  return {
    onSubmit,
    more: () => container.querySelector('details')!,
    // The visible control is the app's own listbox; the choices live in its native select.
    domainChoices: () => [...container.querySelector<HTMLSelectElement>('select[name="domain"]')!.options].map((o) => o.value),
  }
}

describe('ProjectForm', () => {
  it('creates a project from a name alone, with the other details folded away', async () => {
    const user = userEvent.setup()
    const { onSubmit, more } = setup()
    expect(more().open).toBe(false)

    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Mobile app')
    await user.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Mobile app',
      domain: null,
      manager_name: null,
      manager_user_id: null,
      start_date: null,
      end_date: null,
      budget: null,
      region: null,
      priority: 'Medium',
    })
  })

  it('opens the folded details when the problem is inside them', async () => {
    const user = userEvent.setup()
    const { onSubmit, more } = setup({ name: 'Backwards', start_date: '2026-06-01', end_date: '2026-01-01' })

    await user.click(screen.getByRole('button', { name: 'Create Project' }))

    expect(await screen.findByText('End date cannot be before start date')).toBeInTheDocument()
    expect(more().open).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps a project's own domain selectable after it has left the list", () => {
    const { domainChoices } = setup({ domain: 'Motor' })
    expect(domainChoices()).toEqual(['', 'Fintech', 'Motor'])
  })
})
