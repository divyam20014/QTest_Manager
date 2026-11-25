import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedCaseBody, seedDefectBody } from './fixtures'

// ADR-127 phase 5: requirements, test cases, test runs and defects open inside their project
// (/projects/:id/...), keep the project header and tab strip, and the old top-level URLs redirect.

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seed(page: Page) {
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data as { user_id: string }
  const project = await post(page, '/projects', {
    name: 'Record Routes Claims',
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
  const testCase = await post(
    page,
    `/projects/${project.id}/test-cases`,
    await seedCaseBody(page.request, project.id, {
      title: 'Routing test case',
      priority: 'High',
      steps: [{ action: 'Open', expected: 'Opens' }],
    }),
  )
  const defect = await post(page, '/defects', seedDefectBody(project.id, { title: 'Routing defect', severity: 'High', description: 'x' }))
  const requirement = await post(page, `/projects/${project.id}/requirements`, {
    title: 'Routing requirement',
    description: 'x',
  })
  return { projectId: project.id as string, testCaseId: testCase.id as string, defectId: defect.id as string, requirementId: requirement.id as string }
}

test('records open inside their project and the old URLs redirect there', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RecordRoutes')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const ids = await seed(page)
  const tabs = page.getByRole('navigation', { name: 'Project sections' })

  const cases: [string, string, string, string][] = [
    [`/requirements/${ids.requirementId}`, `/projects/${ids.projectId}/requirements/${ids.requirementId}`, 'Requirements', 'Routing requirement'],
    [`/test-cases/${ids.testCaseId}`, `/projects/${ids.projectId}/test-cases/${ids.testCaseId}`, 'Test Cases', 'Routing test case'],
    [`/defects/${ids.defectId}`, `/projects/${ids.projectId}/defects/${ids.defectId}`, 'Defects', 'Routing defect'],
  ]
  for (const [legacy, canonical, tab, heading] of cases) {
    await page.goto(legacy)
    await expect(page).toHaveURL(new RegExp(`${canonical}$`))
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible()
    // The project header and tab strip are around the record, with its own tab marked current.
    await expect(tabs.getByRole('link', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page')
  }

  // The edit pages redirect too.
  await page.goto(`/test-cases/${ids.testCaseId}/edit`)
  await expect(page).toHaveURL(new RegExp(`/projects/${ids.projectId}/test-cases/${ids.testCaseId}/edit$`))
  await page.goto(`/defects/${ids.defectId}/edit`)
  await expect(page).toHaveURL(new RegExp(`/projects/${ids.projectId}/defects/${ids.defectId}/edit$`))
})

test('a record opened under the wrong project moves to its own', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RecordRoutesWrong')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const ids = await seed(page)
  const other = await post(page, '/projects', {
    name: 'Another Project',
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '1000.00',
    region: 'North America',
  })
  await page.goto(`/projects/${other.id}/defects/${ids.defectId}`)
  await expect(page).toHaveURL(new RegExp(`/projects/${ids.projectId}/defects/${ids.defectId}$`))
})

test('lists link to the in-project URLs and creating a defect stays in the project', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'RecordRoutesLists')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const ids = await seed(page)

  await page.goto(`/projects/${ids.projectId}/requirements`)
  await expect(page.getByRole('link', { name: 'Routing requirement' }).first()).toHaveAttribute(
    'href',
    `/projects/${ids.projectId}/requirements/${ids.requirementId}`,
  )
  await page.goto(`/defects?projectId=${ids.projectId}`)
  await expect(page.getByRole('link', { name: 'Routing defect' }).first()).toHaveAttribute(
    'href',
    `/projects/${ids.projectId}/defects/${ids.defectId}`,
  )

  // The old creation URL with a project moves into the project; the project is already chosen.
  await page.goto(`/defects/new?projectId=${ids.projectId}`)
  await expect(page).toHaveURL(new RegExp(`/projects/${ids.projectId}/defects/new$`))
  // The project's Defects tab URL lands on the project-filtered list.
  await page.goto(`/projects/${ids.projectId}/defects`)
  await expect(page).toHaveURL(new RegExp(`/defects\\?projectId=${ids.projectId}$`))
})
