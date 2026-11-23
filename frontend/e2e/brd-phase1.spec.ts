import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, bootstrapTenant, loginViaUi, seedDefectBody, reportDefectFromDialog } from './fixtures'

// BRD gap plan, Phase 1 (frontend only): "Assigned to me" toggles, defect
// status tabs, the Execution Console's MM:SS timer, defect quick view and
// end-of-queue run summary. Each test runs against its own throwaway tenant.

interface Seeded {
  userId: string
  projectId: string
  otherProjectId: string
  caseIds: string[]
}

async function post(page: Page, path: string, data?: unknown) {
  const response = await page.request.post(`${API_BASE_URL}${path}`, { data })
  if (!response.ok()) throw new Error(`POST ${path} failed (${response.status()}): ${await response.text()}`)
  return (await response.json()).data
}

async function seedProject(page: Page, name: string): Promise<{ id: string; assigned_user_ids: string[] }> {
  return post(page, '/projects', {
    name,
    domain: 'Motor',
    priority: 'High',
    manager_name: 'Jane Manager',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    budget: '450000.00',
    region: 'North America',
  })
}

/** Two projects; the first has two approved cases (the first one assigned to
 * the signed-in user) and has that user as a member. */
async function seed(page: Page): Promise<Seeded> {
  const me = (await (await page.request.get(`${API_BASE_URL}/auth/me`)).json()).data
  const userId: string = me.user_id
  const project = await seedProject(page, 'Apex Motor Claims')
  const other = await seedProject(page, 'Borealis Health Launch')
  if (!project.assigned_user_ids.includes(userId)) {
    await post(page, `/projects/${project.id}/members`, { user_id: userId })
  }
  const caseIds: string[] = []
  const cases = [
    {
      title: 'Verify total loss settlement calculation',
      assignee_id: userId,
      steps: [
        { action: 'Input policy number', expected: 'Policy details are shown' },
        { action: 'Submit the total loss claim', expected: 'Payout equals the insured value' },
      ],
    },
    {
      title: 'Reject a duplicate claim submission',
      steps: [{ action: 'Submit the same claim twice', expected: 'The second submission is rejected' }],
    },
  ]
  // ADR-116: module, preconditions, test data and an expected result are required on create.
  const mod = await post(page, `/projects/${project.id}/modules`, { name: 'Claims' })
  for (const c of cases) {
    const created = await post(page, `/projects/${project.id}/test-cases`, {
      priority: 'High',
      module_id: mod.id,
      preconditions: 'The claim exists',
      test_data: 'claim=C-100',
      expected_result: 'The claim is processed',
      ...c,
    })
    await post(page, `/test-cases/${created.id}/submit-review`, {})
    await post(page, `/test-cases/${created.id}/approve`)
    caseIds.push(created.id)
  }
  return { userId, projectId: project.id, otherProjectId: other.id, caseIds }
}

test('Assigned to me / My projects toggles filter the lists and survive a reload', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdToggles')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const seeded = await seed(page)

  // --- Project test case list: drives the existing assigneeId URL filter ----
  await page.goto(`/projects/${seeded.projectId}/test-cases`)
  const table = page.getByRole('table', { name: 'Test cases' })
  await expect(table.getByRole('link', { name: 'Reject a duplicate claim submission' })).toBeVisible()
  const toggle = page.getByRole('group', { name: 'Whose test cases to show' })
  await expect(toggle.getByRole('button', { name: 'All cases' })).toHaveAttribute('aria-pressed', 'true')
  await toggle.getByRole('button', { name: 'Assigned to me' }).click()
  await expect(toggle.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true')
  await expect(table.getByRole('link', { name: 'Verify total loss settlement calculation' })).toBeVisible()
  await expect(table.getByRole('link', { name: 'Reject a duplicate claim submission' })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('assigneeId')).toBe(seeded.userId)
  await expect(page.getByText('Assignee: Me')).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Whose test cases to show' }).getByRole('button', { name: 'Assigned to me' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim submission' })).toHaveCount(0)
  await page
    .getByRole('group', { name: 'Whose test cases to show' })
    .getByRole('button', { name: 'All cases' })
    .click()
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim submission' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('assigneeId')).toBeNull()

  // --- Test Repository: ?assignee=me, sent as assignee_id to the list API ----
  await page.goto('/test-repository')
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim submission' })).toBeVisible()
  const listRequest = page.waitForRequest(
    (r) => r.url().includes(`/projects/${seeded.projectId}/test-cases`) && r.url().includes(`assignee_id=${seeded.userId}`),
  )
  await page
    .getByRole('group', { name: 'Whose test cases to show' })
    .getByRole('button', { name: 'Assigned to me' })
    .click()
  await listRequest
  await expect(page.getByRole('link', { name: 'Verify total loss settlement calculation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim submission' })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('assignee')).toBe('me')
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Whose test cases to show' }).getByRole('button', { name: 'Assigned to me' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('link', { name: 'Verify total loss settlement calculation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reject a duplicate claim submission' })).toHaveCount(0)

  // --- Projects: "My projects" keeps the ones the user is a member of -------
  const projects = (await (await page.request.get(`${API_BASE_URL}/projects?page_size=100`)).json()).data.items as {
    name: string
    assigned_user_ids: string[]
  }[]
  const mine = projects.filter((p) => p.assigned_user_ids.includes(seeded.userId)).map((p) => p.name)
  const notMine = projects.filter((p) => !p.assigned_user_ids.includes(seeded.userId)).map((p) => p.name)
  expect(mine).toContain('Apex Motor Claims')
  await page.goto('/projects')
  const projectTable = page.getByRole('table', { name: 'Projects' })
  await expect(projectTable.getByRole('link')).toHaveCount(projects.length)
  await page.getByRole('group', { name: 'Which projects to show' }).getByRole('button', { name: 'My projects' }).click()
  await expect(projectTable.getByRole('link')).toHaveCount(mine.length)
  for (const name of notMine) await expect(projectTable.getByRole('link', { name })).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('assigned')).toBe('me')
  await page.reload()
  await expect(
    page.getByRole('group', { name: 'Which projects to show' }).getByRole('button', { name: 'My projects' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('table', { name: 'Projects' }).getByRole('link')).toHaveCount(mine.length)
})

test('Defect status tabs: counts, URL state, keyboard, and the empty tab', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdDefectTabs')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const project = await seedProject(page, 'Apex Motor Claims')
  const titles = ['Payout rounds the wrong way', 'Duplicate claim is accepted', 'Deductible ignored on renewal']
  const ids: string[] = []
  for (const title of titles) {
    ids.push((await post(page, '/defects', seedDefectBody(project.id, { title }))).id)
  }
  // Rejected counts as closed (ADR-118), so the Closed tab holds it and Open keeps the other two.
  const patch = await page.request.patch(`${API_BASE_URL}/defects/${ids[0]}/status`, {
    data: { status: 'Rejected', resolution: 'Duplicate' },
  })
  expect(patch.ok()).toBe(true)

  await page.goto('/defects')
  const tabs = page.getByRole('tablist', { name: 'Defect status' })
  await expect(tabs.getByRole('tab')).toHaveText(['All3', 'Open2', 'Fixed0', 'Retest0', 'Reopened0', 'Deferred0', 'Closed1'])
  await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')
  const table = page.getByRole('table', { name: 'Defects' })
  await expect(table.getByRole('link', { name: /^BUG_/ })).toHaveCount(3)

  await tabs.getByRole('tab', { name: /^Closed/ }).click()
  await expect(table.getByRole('link', { name: /^BUG_/ })).toHaveCount(1)
  await expect(table.getByRole('link', { name: 'Payout rounds the wrong way' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('status')).toBe('Closed,Rejected')
  // The table is the tab panel, labelled by the selected tab.
  await expect(page.getByRole('tabpanel', { name: /^Closed/ })).toBeVisible()

  // Roving tabindex + arrow keys, as in the WAI-ARIA tabs pattern.
  await tabs.getByRole('tab', { name: /^Closed/ }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(tabs.getByRole('tab', { name: /^Deferred/ })).toBeFocused()
  await expect(tabs.getByRole('tab', { name: /^Deferred/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('No defects match your filters')).toBeVisible()
  await page.keyboard.press('Home')
  await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true')
  expect(new URL(page.url()).searchParams.get('status')).toBeNull()

  // A deep link / reload lands on the same tab.
  await page.goto('/defects?status=Closed,Rejected')
  await expect(page.getByRole('tab', { name: /^Closed/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('table', { name: 'Defects' }).getByRole('link', { name: /^BUG_/ })).toHaveCount(1)

  // Phone: the strip scrolls sideways inside itself, tabs are 44px, no page overflow.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/defects')
  const phoneTabs = page.getByRole('tablist', { name: 'Defect status' })
  await expect(phoneTabs).toBeVisible()
  expect((await phoneTabs.getByRole('tab', { name: /^All/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0)
  await phoneTabs.getByRole('tab', { name: /^Deferred/ }).click()
  await expect(page.getByText('No defects match your filters')).toBeVisible()
})

test('A run cannot be created for a project with no test cases', async ({ page, request }) => {
  // BRD FR-EXEC-01 / validation matrix: verified, not changed, in Phase 1.
  const tenant = await bootstrapTenant(request, 'BrdEmptyRun')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const project = await seedProject(page, 'Empty Motor Project')

  await page.goto(`/projects/${project.id}/test-runs`)
  await page.getByRole('button', { name: 'New Test Run' }).click()
  await page.fill('#run-name', 'Run with nothing in it')
  await expect(page.getByText(/No approved test cases in this project yet/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Test Run' })).toBeDisabled()

  // The server refuses it too, independently of the UI.
  const response = await page.request.post(`${API_BASE_URL}/projects/${project.id}/test-runs`, {
    data: { name: 'Run with nothing in it', run_type: 'Regression', test_case_ids: [] },
  })
  expect(response.status()).toBe(422)
})

test('Execution Console: MM:SS timer, defect quick view, and the run summary', async ({ page, request }) => {
  const tenant = await bootstrapTenant(request, 'BrdConsole')
  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  const seeded = await seed(page)
  const run = await post(page, `/projects/${seeded.projectId}/test-runs`, {
    name: 'Sprint 42 Motor Regression',
    run_type: 'Regression',
    test_case_ids: seeded.caseIds,
  })
  const firstCase = run.cases.find((c: { title: string }) => c.title.startsWith('Verify total loss'))

  await page.goto(`/test-run-cases/${firstCase.id}?runId=${run.id}`)
  await expect(page.getByRole('heading', { name: 'Verify total loss settlement calculation' })).toBeVisible()

  // Timer: a stop-clock, exposed as role=timer with a spoken label.
  const timer = page.getByRole('timer')
  await expect(timer).toHaveText(/^\d\d:\d\d elapsed$/, { timeout: 10000 })
  await expect(timer).toHaveAttribute('aria-label', /^Time on this step: \d+ seconds?$/)

  // Pass step 1, fail step 2 -> the report dialog opens for that step.
  await page.getByRole('button', { name: /^Pass/ }).click()
  await expect(page.getByText('1/2 steps complete')).toBeVisible()
  await page.fill('#actual-result', 'Payout was 10% below the insured value')
  await page.getByRole('button', { name: /^Fail/ }).click()
  await reportDefectFromDialog(page, { severity: 'Critical', description: 'Payout is 10% below the insured value' })

  // The failed step now carries a defect pill that opens the quick view.
  const pill = page.getByRole('button', { name: /^View defect: TC_\d+ .* failed$/ })
  await expect(pill).toBeVisible({ timeout: 10000 })
  await pill.click()
  const quickView = page.getByRole('dialog', { name: 'Defect details' })
  await expect(quickView).toBeVisible()
  await expect(quickView.getByText('Severity: Critical')).toBeVisible()
  await expect(quickView.getByText('Status: New')).toBeVisible()
  await expect(quickView.getByText('Admin E2E')).toBeVisible()
  await expect(quickView.getByText('Payout is 10% below the insured value')).toBeVisible()
  await expect(quickView.getByText('Step 2', { exact: true })).toBeVisible()
  await expect(quickView.getByText('Sprint 42 Motor Regression')).toBeVisible()
  await expect(quickView.getByRole('link', { name: 'Open in Defects' })).toHaveAttribute('href', /^\/defects\/[0-9a-f-]{36}$/)
  await page.keyboard.press('Escape')
  await expect(quickView).toBeHidden()
  await expect(pill).toBeFocused()

  // Recorded step durations read as a clock or milliseconds, never "1234ms".
  await expect(page.getByText(/^\d+ms$/)).toHaveCount(0)

  // One case is still open, so this is "Next case", not the summary yet.
  await expect(page.getByRole('heading', { name: /test cases in this run/ })).toHaveCount(0)
  await page.getByRole('link', { name: /^Next case: Reject a duplicate/ }).click()
  await expect(page.getByRole('heading', { name: 'Reject a duplicate claim submission' })).toBeVisible()
  await page.getByRole('button', { name: /^Pass/ }).click()

  // Last case done -> the summary, with figures from the run itself.
  const summary = page.getByRole('region', { name: 'All test cases in this run have a result' })
  await expect(summary).toBeVisible({ timeout: 10000 })
  const tile = (label: string) => summary.locator('dl').first().locator('div', { hasText: label })
  await expect(tile('Passed').locator('dd')).toHaveText('1')
  await expect(tile('Failed').locator('dd')).toHaveText('1')
  await expect(tile('Ignored').locator('dd')).toHaveText('0')
  await expect(tile('Open').locator('dd')).toHaveText('0')
  await expect(summary.getByText('Blocked')).toHaveCount(0)
  await expect(summary.locator('div', { hasText: /^Defects raised/ }).locator('dd')).toHaveText('1')
  // One case failed, so the run stays open for the re-run after the fix (ADR-070).
  await expect(summary.locator('div', { hasText: /^Run status/ }).locator('dd')).toHaveText('Active')
  await expect(summary.getByRole('link', { name: 'View report' })).toHaveAttribute(
    'href',
    `/reporting?project=${seeded.projectId}`,
  )
  // Exactly one "Back to the run" on screen (the summary's own).
  await expect(page.getByRole('link', { name: 'Back to the run' })).toHaveCount(1)
  await summary.getByRole('link', { name: 'Back to the run' }).click()
  await expect(page).toHaveURL(new RegExp(`/test-runs/${run.id}$`))
  await expect(page.getByText('Sprint 42 Motor Regression').first()).toBeVisible()
})
