import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi } from './fixtures'

// ADR-127 phase 6: the Task progress widget on the project Overview, the traceability matrix by task,
// tasks in the command palette search, and the tasks source of the report builder.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seed(page: Page) {
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Task Reports Claims',
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
  const parent = await post(page, `/projects/${project.id}/tasks`, { title: 'Quotation engine' })
  await post(page, `/projects/${project.id}/tasks`, { title: 'Premium rules', parent_task_id: parent.id })
  await post(page, `/projects/${project.id}/tasks`, { title: 'Late task', due_date: '2020-01-01' })
  await post(page, `/projects/${project.id}/requirements`, {
    title: 'Quote within two seconds',
    description: 'x',
    task_id: parent.id,
  })
  await post(page, `/projects/${project.id}/requirements`, { title: 'Unrelated requirement', description: 'x' })
  return { projectId: project.id as string, parent }
}

test('the project Overview shows task progress and links into the Tasks tab', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'TaskReportsOverview')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId } = await seed(page)

  await page.goto(`/projects/${projectId}`)
  const widget = page.getByTestId('widget-task_progress')
  await expect(widget).toBeVisible()
  // Three tasks plus the project's "Unassigned requirements" task, which the loose requirement created.
  await expect(widget.getByText('0 of 4 done')).toBeVisible()
  await expect(widget.getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute('aria-valuenow', '0')
  await expect(widget.getByText('Overdue').locator('..')).toContainText('1')

  await widget.getByRole('link', { name: 'To Do' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks\\?status=`))
  await expect(page.getByRole('link', { name: 'Late task' }).first()).toBeVisible()
})

test('the traceability matrix can be narrowed to one task', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'TaskReportsMatrix')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId, parent } = await seed(page)

  await page.goto(`/projects/${projectId}/traceability-matrix`)
  await expect(page.getByRole('link', { name: 'Unrelated requirement' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Quote within two seconds' }).first()).toBeVisible()

  await page.goto(`/projects/${projectId}/traceability-matrix?task=${parent.id}`)
  await expect(page.getByRole('link', { name: 'Quote within two seconds' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Unrelated requirement' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Include sub-tasks' })).toBeVisible()
})

test('search finds tasks by their ID and the report builder has a Tasks source', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'TaskReportsSearch')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { projectId, parent } = await seed(page)

  await page.goto(`/projects/${projectId}`)
  await page.getByRole('search').getByRole('button').click()
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.getByLabel('Command palette search').fill('quotation')
  const hit = palette.getByText(/Quotation engine/).first()
  await expect(hit).toBeVisible()
  await hit.click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/tasks/${parent.id}$`))

  const sources = (await (await page.request.get(`${API_BASE_URL}/report-builder/sources`)).json()).data as {
    key: string
  }[]
  expect(sources.map((s) => s.key)).toContain('tasks')
})
