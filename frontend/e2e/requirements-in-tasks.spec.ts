import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-128: the project-level Requirements section is folded into tasks. Requirements are created and
// managed on their task; one without a task lives in the project's "Unassigned requirements" task.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seed(page: Page) {
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Requirements In Tasks',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  if (!project.assigned_user_ids.includes(me.user_id)) {
    await post(page, `/projects/${project.id}/members`, { user_id: me.user_id })
  }
  const task = await post(page, `/projects/${project.id}/tasks`, { title: 'Quotation engine' })
  return { projectId: project.id as string, task }
}

test('there is no Requirements tab, and its old URL lands on Tasks', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'ReqInTasksTab')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId } = await seed(page)

  await page.goto(`/projects/${projectId}`)
  const tabs = page.getByRole('navigation', { name: 'Project sections' })
  await expect(tabs.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Requirements' })).toHaveCount(0)

  await page.goto(`/projects/${projectId}/requirements`)
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks$`))
})

test('a requirement is created on its task and opens from there', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'ReqInTasksCreate')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId, task } = await seed(page)

  await page.goto(`/projects/${projectId}/tasks/${task.id}`)
  await page.getByRole('tab', { name: /Requirements/ }).click()
  await expect(page.getByText('No requirements in this task')).toBeVisible()
  await page.getByRole('button', { name: 'New requirement' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New Requirement' })
  // Created in this task: the task is not asked for again.
  await expect(dialog.getByLabel('Task')).toHaveCount(0)
  await dialog.getByLabel('Title').fill('Quote within two seconds')
  await dialog.getByRole('button', { name: 'Create Requirement' }).click()

  const link = page.getByRole('link', { name: 'Quote within two seconds' })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/requirements/[0-9a-f-]+$`))
  // The requirement page keeps its task, and the Tasks tab is the current one.
  await expect(page.getByRole('link', { name: /Quotation engine/ }).first()).toBeVisible()
  const tabs = page.getByRole('navigation', { name: 'Project sections' })
  await expect(tabs.getByRole('link', { name: 'Tasks', exact: true })).toHaveAttribute('aria-current', 'page')
})

test('the quick-create link opens the dialog, and a loose requirement goes to the default task', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'ReqInTasksDefault')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId } = await seed(page)

  await page.goto(`/projects/${projectId}/tasks?action=new-requirement`)
  const dialog = page.getByRole('dialog', { name: 'New Requirement' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Title').fill('A loose requirement')
  await dialog.getByRole('button', { name: 'Create Requirement' }).click()
  await expect(dialog).toBeHidden()

  // The default task now exists, is marked, and holds it.
  await expect(page.getByText('Default for requirements').first()).toBeVisible()
  await page.getByRole('link', { name: 'Unassigned requirements' }).first().click()
  await page.getByRole('tab', { name: /Requirements/ }).click()
  await expect(page.getByRole('link', { name: 'A loose requirement' })).toBeVisible()
  // It cannot take sub-tasks and cannot be deleted.
  await expect(page.getByRole('button', { name: 'Add sub-task' })).toHaveCount(0)
})

test('deleting a task keeps its requirements, under the default task', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'ReqInTasksDelete')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId, task } = await seed(page)
  const requirement = await post(page, `/projects/${projectId}/requirements`, {
    title: 'Survives its task',
    description: 'x',
    task_id: task.id,
  })

  const deleted = await page.request.delete(`${API_BASE_URL}/tasks/${task.id}`)
  expect(deleted.ok()).toBeTruthy()
  const after = (await (await page.request.get(`${API_BASE_URL}/requirements/${requirement.id}`)).json()).data
  expect(after.task_title).toBe('Unassigned requirements')

  await page.goto(`/projects/${projectId}/requirements/${requirement.id}`)
  await expect(page.getByRole('heading', { name: 'Survives its task' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Unassigned requirements/ }).first()).toBeVisible()
})
