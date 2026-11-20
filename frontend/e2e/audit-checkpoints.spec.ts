import { expect, test, type Page } from '@playwright/test'

import {
  bootstrapTenant,
  createEnrolledThrowawayPlatformAdmin,
  deactivateThrowawayPlatformAdmin,
  loginViaUi,
} from './fixtures'

// ADR-085: signed audit-chain checkpoints, end to end in the browser, on a
// throwaway tenant (so the chain it anchors is tiny and entirely its own).

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('Audit Logs: create a checkpoint, verify it, and a second create is a no-op', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const tenant = await bootstrapTenant(request, 'Checkpoint')
  const shots = process.env.E2E_SHOTS_DIR

  await loginViaUi(page, tenant.tenantId, tenant.adminEmail, tenant.adminPassword)
  await page.goto('/admin/audit-logs')
  await page.waitForSelector('h1:has-text("Audit Logs")')

  await page.getByRole('button', { name: 'Create checkpoint' }).click()
  await expect(page.getByTestId('audit-checkpoint-result')).toContainText('Checkpoint created')

  await page.getByRole('button', { name: 'Verify Chain Integrity' }).click()
  await expect(page.getByTestId('audit-verify-result')).toContainText('Chain verified')
  await expect(page.getByTestId('audit-checkpoint-status')).toHaveText('1 checkpoint verified.')

  if (shots) await page.screenshot({ path: `${shots}/audit-checkpoints-1280.png` })

  // Nothing new happened (the checkpoint itself is not an audit event).
  await page.getByRole('button', { name: 'Create checkpoint' }).click()
  await expect(page.getByTestId('audit-checkpoint-result')).toContainText(
    'No new events since the last checkpoint.',
  )

  // The export downloads a JSON document with the one checkpoint.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export checkpoints' }).click()
  expect((await download).suggestedFilename()).toBe('audit_checkpoints.json')

  await page.setViewportSize({ width: 390, height: 844 })
  await noHorizontalOverflow(page)
  if (shots) await page.screenshot({ path: `${shots}/audit-checkpoints-390.png`, fullPage: true })
})

test('Platform Admin Audit tab: create a checkpoint and see it verified', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const admin = await createEnrolledThrowawayPlatformAdmin(request, 'audit-e2e-cp')
  const shots = process.env.E2E_SHOTS_DIR
  try {
    await page.goto('/platform-admin')
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByLabel('Authentication code').fill(await admin.nextCode())
    await page.getByRole('button', { name: 'Verify' }).click()
    await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()
    await page.getByRole('tab', { name: 'Audit' }).click()

    await page.getByRole('button', { name: 'Create checkpoint' }).click()
    await expect(page.getByTestId('audit-verify-result')).toContainText('Checkpoint created')
    await page.getByRole('button', { name: 'Verify chain' }).click()
    await expect(page.getByTestId('audit-verify-result')).toContainText('Chain verified')
    await expect(page.getByTestId('audit-checkpoint-status')).toContainText('checkpoint')
    await expect(page.getByTestId('audit-checkpoint-status')).toContainText('verified.')

    if (shots) await page.screenshot({ path: `${shots}/platform-checkpoints-1280.png` })
    await page.setViewportSize({ width: 390, height: 844 })
    await noHorizontalOverflow(page)
    if (shots) {
      await page.screenshot({ path: `${shots}/platform-checkpoints-390.png`, fullPage: true })
    }
  } finally {
    await deactivateThrowawayPlatformAdmin(request, admin.id)
  }
})
