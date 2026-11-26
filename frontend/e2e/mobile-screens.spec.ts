import { expect, test, type Page } from '@playwright/test'

import { smallTargets } from './a11y'
import { API_BASE_URL, bootstrapTenant, loginViaUi, seedCaseBody, seedDefectBody } from './fixtures'

// Mobile redesign Phase 3: the remaining list pages as card lists, the
// Execution Console's pinned verdict bar, the one-column Dashboard, the
// Traceability drill-down cards, the Roles & Permissions role picker, the
// Audit Log cards and the stacked detail pages -- all at 390px.
test.use({ viewport: { width: 390, height: 844 } })
test.setTimeout(90_000)

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function seed(page: Page) {
  const api = page.request
  const project = (
    await (
      await api.post(`${API_BASE_URL}/projects`, {
        data: {
          name: 'Apex Motor Claims',
          domain: 'Motor',
          priority: 'High',
          manager_name: 'Jane Manager',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          budget: '450000.00',
          region: 'North America',
        },
      })
    ).json()
  ).data
  const caseIds: string[] = []
  for (const title of ['Verify claim settlement calculation', 'Reject a duplicate claim submission']) {
    const tc = (
      await (
        await api.post(`${API_BASE_URL}/projects/${project.id}/test-cases`, {
          data: await seedCaseBody(api, project.id, {
            title,
            priority: 'High',
            steps: [
              { action: 'Open the claim', expected: 'The claim loads' },
              { action: 'Submit the claim', expected: 'The claim is accepted' },
            ],
          }),
        })
      ).json()
    ).data
    await api.post(`${API_BASE_URL}/test-cases/${tc.id}/submit-review`, { data: {} })
    await api.post(`${API_BASE_URL}/test-cases/${tc.id}/approve`, { data: {} })
    caseIds.push(tc.id)
  }
  const run = (
    await (
      await api.post(`${API_BASE_URL}/projects/${project.id}/test-runs`, {
        data: { name: 'Sprint 42 Regression', run_type: 'Regression', test_case_ids: caseIds },
      })
    ).json()
  ).data
  const req = (
    await (
      await api.post(`${API_BASE_URL}/projects/${project.id}/requirements`, {
        data: { title: 'Claims settlement must be calculated correctly', description: 'Seeded' },
      })
    ).json()
  ).data
  return { project, run, caseIds, requirement: req }
}

test('mobile screens: cards, pinned verdict bar, dashboard, traceability, roles, audit, detail', async ({
  page,
  request,
}) => {
  const tenant = await bootstrapTenant(request, 'MobileScreens')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const { project, run } = await seed(page)

  // --- Dashboard: single column, KPI cards stacked ------------------
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Step pass rate:/ })).toBeVisible()
  await noHorizontalOverflow(page)

  // --- Projects: card list + sort/filters in the sheet -------------------------
  await page.goto('/projects')
  const projectCards = page.getByRole('list', { name: 'Projects' })
  await expect(projectCards.getByRole('listitem')).toHaveCount(1)
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)
  await page.getByRole('button', { name: /^Filters/ }).click()
  const filters = page.getByRole('dialog', { name: 'Filters' })
  await expect(filters.getByRole('combobox', { name: 'Sort by' })).toBeVisible()
  await page.keyboard.press('Escape')

  // --- Traceability: cards, no sideways scroll (requirements live in tasks, ADR-128) ----------
  await page.goto(`/projects/${project.id}/traceability-matrix`)
  const matrix = page.getByRole('list', { name: 'Requirements traceability' })
  await expect(matrix.getByRole('listitem')).toHaveCount(1)
  await expect(matrix.getByText('Uncovered')).toBeVisible()
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)

  // --- Test runs: project list, cross-project overview, run detail -----------
  await page.goto(`/projects/${project.id}/test-runs`)
  await expect(page.getByRole('list', { name: 'Test runs' }).getByRole('listitem')).toHaveCount(1)
  await noHorizontalOverflow(page)
  await page.goto('/test-runs')
  await expect(page.getByRole('list', { name: 'Test runs' }).getByRole('listitem')).toHaveCount(1)
  await page.goto(`/test-runs/${run.id}`)
  const runCases = page.getByRole('list', { name: 'Test cases in this run' })
  await expect(runCases.getByRole('listitem')).toHaveCount(2)
  await noHorizontalOverflow(page)
  const execute = runCases.getByRole('listitem').first().getByRole('link', { name: 'Execute' })
  expect((await execute.boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // --- Execution Console: pinned Pass / Fail / Ignore bar ----------------------
  await execute.click()
  const verdicts = page.getByRole('group', { name: 'Record a verdict for the current step' })
  await expect(verdicts).toBeVisible()
  await expect(verdicts).toBeInViewport()
  const pass = verdicts.getByRole('button', { name: /^Pass/ })
  const fail = verdicts.getByRole('button', { name: /^Fail/ })
  const ignore = verdicts.getByRole('button', { name: /^Ignore/ })
  for (const b of [pass, fail, ignore]) {
    const box = (await b.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  // The bar clears the bottom tab bar (it must never sit underneath it).
  const barBox = (await verdicts.boundingBox())!
  const tabBox = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabBox.y + 1)
  await noHorizontalOverflow(page)
  await pass.click()
  await expect(page.getByText('1/2 steps complete')).toBeVisible()
  // The run's case list is collapsed behind a toggle on a phone.
  const casesToggle = page.getByRole('button', { name: /cases/ })
  expect((await casesToggle.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await casesToggle.click()
  await expect(page.locator('#run-cases-list')).toBeVisible()

  // --- Users & Roles, Roles & Permissions, Audit Logs ---------------------------
  await page.goto('/admin/users')
  await expect(page.getByRole('list', { name: 'Users' }).getByRole('listitem').first()).toBeVisible({
    timeout: 15000,
  })
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)

  await page.goto('/admin/roles')
  const roleSelect = page.getByRole('combobox', { name: 'Role', exact: true })
  await expect(roleSelect).toBeVisible()
  expect((await roleSelect.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(page.locator('table')).toHaveCount(0)
  await noHorizontalOverflow(page)

  await page.goto('/admin/audit-logs')
  const entries = page.getByRole('list', { name: 'Audit log entries' })
  await expect(entries.getByRole('listitem').first()).toBeVisible({ timeout: 15000 })
  await expect(page.locator('table')).toHaveCount(0)
  const details = entries.getByRole('button', { name: 'Details' }).first()
  await details.click()
  await expect(entries.getByText('Record Hash').first()).toBeVisible()
  await noHorizontalOverflow(page)

  // --- ADR-126: My Work, the project tabs, boards, the calendar agenda and Workspace settings --
  await page.request.post(`${API_BASE_URL}/defects`, {
    data: seedDefectBody(project.id, { title: 'Settlement rounds down' }),
  })
  const task = await page.request.post(`${API_BASE_URL}/projects/${project.id}/tasks`, {
    data: { title: 'Settlement engine', due_date: '2026-12-01' },
  })
  const taskId = (await task.json()).data.id as string
  await page.request.post(`${API_BASE_URL}/projects/${project.id}/tasks`, {
    data: { title: 'Rounding rules', parent_task_id: taskId },
  })
  for (const route of [
    '/my-work',
    `/projects/${project.id}`,
    `/projects/${project.id}/test-plans`,
    `/projects/${project.id}/team`,
    `/projects/${project.id}/settings`,
    `/defects?projectId=${project.id}&view=board`,
    `/projects/${project.id}/test-cases?view=board`,
    `/projects/${project.id}/test-runs?view=board`,
    `/projects/${project.id}/test-runs?view=calendar`,
    // ADR-127: tasks, the board and the task page.
    `/projects/${project.id}/tasks`,
    `/projects/${project.id}/tasks?view=board`,
    `/projects/${project.id}/tasks/${taskId}`,
    '/admin/task-statuses',
    // Last: the checks right after the loop use the Workspace settings page.
    '/admin/workspace',
  ]) {
    await page.goto(route)
    await expect(page.locator('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await noHorizontalOverflow(page)
    expect(await smallTargets(page, 24), `${route} targets under 24px`).toEqual([])
  }
  // The calendar is an agenda list on a phone, not a seven-column grid.
  await expect(page.getByRole('region', { name: 'Test run calendar' }).getByRole('grid')).toHaveCount(0)
  // Workspace settings keep 44px controls on a phone.
  const upButton = page.getByRole('button', { name: /^Move .* up$/ }).first()
  expect((await upButton.boundingBox())!.height).toBeGreaterThanOrEqual(43)

  // --- Detail pages stack and never scroll sideways ----------------------------
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('heading', { name: 'Apex Motor Claims' })).toBeVisible()
  await noHorizontalOverflow(page)
  await page.goto('/test-repository')
  await page.getByRole('list', { name: 'Test cases' }).getByRole('link').first().click()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  await noHorizontalOverflow(page)
})

test('mobile forms: sign-in fields carry the right keyboard and autofill hints', async ({ page }) => {
  await page.goto('/login')
  const email = page.locator('#email')
  await expect(email).toHaveAttribute('type', 'email')
  await expect(email).toHaveAttribute('inputmode', 'email')
  await expect(email).toHaveAttribute('autocomplete', 'username')
  expect(await email.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)

  await page.goto('/signup')
  await expect(page.locator('#signup-email')).toHaveAttribute('autocomplete', 'email')
  await expect(page.locator('#signup-password')).toHaveAttribute('autocomplete', 'new-password')
  await noHorizontalOverflow(page)
})
