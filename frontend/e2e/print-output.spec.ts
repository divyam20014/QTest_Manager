import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loginViaUi } from './fixtures'
import { PLATFORM_DOCS_USER_AGENT, signInPlatformBrowser } from './platformDocs'
import { seedRoleTenant } from './roleTenant'

// Issue 37 / ADR-114: print / PDF output of the platform console documents and the compliance print
// view. Chromium's print media is emulated (page.emulateMedia) and the page is
// also rendered with page.pdf(). Asserts the print-media COMPUTED styles: app
// chrome hidden, background light even when the saved theme is dark, tables and
// diagrams not clipped by the page width, long code wraps, headings keep with
// their content. Evidence (screenshots + PDFs) goes to E2E_SHOTS_DIR when set.
// Throwaway tenant only.

test.use({ userAgent: PLATFORM_DOCS_USER_AGENT })

const SHOTS = process.env.E2E_SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// A4 at 96 dpi minus the default 0.4in margins is about 700 CSS px of content.
const PAPER = { width: 794, height: 1123 }

async function luminance(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    const parts = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number)
    // Fully transparent paints as the (white) paper.
    if (parts.length > 3 && parts[3] === 0) return 1
    const [r, g, b] = parts
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }, selector)
}

async function textLuminance(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement
    const [r, g, b] = getComputedStyle(el)
      .color.match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }, selector)
}

async function savePdf(page: Page, name: string) {
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  if (SHOTS) {
    writeFileSync(join(SHOTS, `${name}.pdf`), pdf)
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
  }
  return pages
}

/** Anything painted wider than the printable page (clipped on paper). */
async function overflowingBoxes(page: Page): Promise<string[]> {
  return page.evaluate((limit) => {
    const out: string[] = []
    const root = document.querySelector('.brd-print-area, .compliance-print') as HTMLElement
    for (const el of root.querySelectorAll<HTMLElement>('table, pre, svg, img, .brd-table-wrap')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > limit + 1) out.push(`${el.tagName.toLowerCase()} right=${Math.round(r.right)} (limit ${limit})`)
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
        out.push(`${el.tagName.toLowerCase()} scrolls (scrollWidth ${el.scrollWidth} > ${el.clientWidth})`)
    }
    return out
  }, PAPER.width)
}

const DOCS = [
  { slug: 'sequence-diagrams', kind: 'mermaid diagrams' },
  { slug: 'known-gaps', kind: 'wide tables' },
  { slug: 'architecture-decisions', kind: 'long document' },
]

test('print media: platform documents (dark theme saved) print light, without app chrome, unclipped', async ({
  page,
  context,
}) => {
  test.setTimeout(600_000)
  await signInPlatformBrowser(context)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('qtesthub:theme', 'dark')
    } catch {
      /* ignore */
    }
  })
  await page.setViewportSize(PAPER)

  const problems: string[] = []
  for (const doc of DOCS) {
    await page.emulateMedia({ media: 'screen', colorScheme: 'dark' })
    await page.goto(`/platform-admin/docs/${doc.slug}`)
    await expect(page.locator('.brd-print-area')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    if (doc.slug === 'sequence-diagrams') {
      await expect(page.locator('.brd-diagram-canvas svg').first()).toBeVisible({ timeout: 90_000 })
      // Let every diagram finish rendering before switching media.
      await page.waitForTimeout(3000)
    }
    // On screen the dark theme is dark (the premise of the check).
    expect(await luminance(page, 'body')).toBeLessThan(0.3)

    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.waitForTimeout(300)

    // Chrome hidden: app shell sidebar/header/mobile nav and the doc picker.
    const visibleChrome = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.qth-shell-chrome, .brd-noprint'))
        .filter((e) => getComputedStyle(e).display !== 'none')
        .map((e) => e.tagName.toLowerCase() + '.' + e.className.toString().slice(0, 40)),
    )
    if (visibleChrome.length) problems.push(`${doc.slug}: chrome visible in print: ${visibleChrome.join(', ')}`)
    for (const sel of ['aside[aria-label="Sidebar"]', 'header']) {
      const shown = await page.evaluate(
        (s) =>
          Array.from(document.querySelectorAll<HTMLElement>(s)).filter(
            (e) => !e.closest('.brd-print-area') && getComputedStyle(e).display !== 'none',
          ).length,
        sel,
      )
      if (shown) problems.push(`${doc.slug}: ${sel} still displayed in print`)
    }

    // Light paper whatever the saved theme: page + body light, prose text dark.
    for (const sel of ['html', 'body']) {
      if ((await luminance(page, sel)) < 0.9) problems.push(`${doc.slug}: ${sel} background is dark in print`)
    }
    if ((await textLuminance(page, '.brd-print-area')) > 0.3) problems.push(`${doc.slug}: prose text is light in print`)

    // Tables/diagrams/pre fit the page; long code wraps; headings stay with content.
    for (const o of await overflowingBoxes(page)) problems.push(`${doc.slug}: ${o}`)
    const pre = await page.evaluate(() => {
      const p = document.querySelector('.brd-prose pre') as HTMLElement | null
      return p ? getComputedStyle(p).whiteSpace : 'pre-wrap'
    })
    if (!/wrap/.test(pre)) problems.push(`${doc.slug}: <pre> does not wrap (${pre})`)
    const headingBreak = await page.evaluate(() => {
      const h = document.querySelector('.brd-prose h2') as HTMLElement | null
      return h ? getComputedStyle(h).breakAfter : 'avoid'
    })
    if (!/avoid/.test(headingBreak)) problems.push(`${doc.slug}: h2 may split from its content (${headingBreak})`)

    const toolbar = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('button'))
          .filter((b) => /Print \/ PDF|Copy Markdown|Download \.md/.test(b.textContent ?? ''))
          .filter((b) => b.offsetParent !== null).length,
    )
    if (toolbar) problems.push(`${doc.slug}: ${toolbar} toolbar buttons visible in print`)
    if (doc.slug === 'sequence-diagrams') {
      const filter = await page.evaluate(
        () => getComputedStyle(document.querySelector('.brd-diagram-canvas svg') as Element).filter,
      )
      if (!/invert/.test(filter)) problems.push(`${doc.slug}: dark diagram is not flipped to light (${filter})`)
    }

    const pages = await savePdf(page, `print-${doc.slug}`)
    if (pages < 1) problems.push(`${doc.slug}: PDF has no pages`)
    if (doc.slug === 'architecture-decisions' && pages < 5) problems.push(`${doc.slug}: long doc only ${pages} PDF pages`)
  }
  expect(problems, problems.join('\n')).toEqual([])
})

test('print media: the compliance print view hides its controls, prints light and unclipped', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  const t = await seedRoleTenant(request, 'PrintCompliance', { withData: true })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('qtesthub:theme', 'dark')
    } catch {
      /* ignore */
    }
  })
  await page.setViewportSize(PAPER)
  await loginViaUi(page, t.tenantId, t.adminEmail, t.adminPassword)
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' })
  await page.goto('/reporting/print')
  await expect(page.getByRole('heading', { name: /Compliance Report$/ }).last()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.compliance-print table').first()).toBeVisible()

  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  await page.waitForTimeout(300)
  const hidden = await page.evaluate(
    () => getComputedStyle(document.querySelector('.no-print') as HTMLElement).display,
  )
  expect(hidden).toBe('none')
  for (const sel of ['html', 'body']) expect(await luminance(page, sel), sel).toBeGreaterThan(0.9)
  expect(await luminance(page, '.compliance-print')).toBeGreaterThan(0.9)
  expect(await textLuminance(page, '.compliance-print')).toBeLessThan(0.2)
  expect(await overflowingBoxes(page)).toEqual([])
  const pages = await savePdf(page, 'print-compliance')
  expect(pages).toBeGreaterThanOrEqual(1)
})
