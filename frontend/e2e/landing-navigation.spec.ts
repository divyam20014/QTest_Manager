import { expect, type Page, test } from "@playwright/test";

import { axeFindings } from "./a11y";

// Landing page navigation, flow and motion (ADR-095). Public page, no tenant.

const NAV_PATHS = [
  "/platform",
  "/features",
  "/quality-intelligence",
  "/security",
  "/solutions",
  "/about",
  "/pricing",
  "/contact",
  "/request-demo",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
];

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("footer")).toBeAttached();
}

test.describe("desktop 1280", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("header condenses and progress bar grows on scroll", async ({
    page,
  }) => {
    await openHome(page);
    const header = page.locator("header.lp-nav");
    await expect(header).toHaveAttribute("data-condensed", "false");
    const before = await page
      .locator("main")
      .evaluate((el) => el.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(header).toHaveAttribute("data-condensed", "true");
    await expect
      .poll(async () => (await header.boundingBox())?.height)
      .toBeLessThan(60);
    const docTop = await page
      .locator("main")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(docTop).toBe(before); // condensing never moves content
    const bar = page.getByTestId("lp-progress");
    const w1 = (await bar.boundingBox())!.width;
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight / 2),
    );
    await expect
      .poll(async () => (await bar.boundingBox())!.width)
      .toBeGreaterThan(w1 + 50);
  });

  test("rail anchor scrolls, sets aria-current and moves focus", async ({
    page,
  }) => {
    await openHome(page);
    const dot = page
      .getByRole("navigation", { name: "Page sections", exact: true })
      .getByRole("link", { name: "Capabilities" });
    await dot.click();
    await expect(page.locator("#lp-features-title")).toBeFocused();
    await expect(dot).toHaveAttribute("aria-current", "location");
    const top = await page
      .locator("#lp-features-title")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(50); // clear of the sticky header
  });

  test("skip link focuses main content", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#lp-main")).toBeFocused();
  });

  test("back to top appears after the first screen and returns", async ({
    page,
  }) => {
    await openHome(page);
    const btn = page.getByRole("button", { name: "Back to top" });
    await expect(btn).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 1600));
    await expect(btn).toBeVisible();
    await btn.click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(5);
  });

  test("every nav and footer link resolves", async ({ page }) => {
    for (const path of NAV_PATHS) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator("main").first(), path).not.toBeEmpty();
      await expect(page.locator("h1").first(), path).toBeVisible();
    }
    await openHome(page);
    const hrefs = await page
      .locator("header a[href], footer a[href]")
      .evaluateAll((els) =>
        [
          ...new Set(
            els.map((a) => (a as HTMLAnchorElement).getAttribute("href")!),
          ),
        ].filter((h) => h.startsWith("/")),
      );
    expect(hrefs.length).toBeGreaterThan(15);
    for (const href of hrefs) {
      const [path, hash] = href.split("#");
      expect(NAV_PATHS.concat("/", "/login").includes(path || "/"), href).toBe(
        true,
      );
      if (hash) {
        await page.goto(href);
        await expect(page.locator(`[id="${hash}"]`), href).toHaveCount(1);
      }
    }
  });

  test("axe: light", async ({ page }) => {
    // Reduced motion keeps axe from sampling mid-fade colours.
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.addInitScript(() =>
      localStorage.setItem("qtesthub:theme", "light"),
    );
    await openHome(page);
    await page.waitForLoadState("networkidle");
    expect(await axeFindings(page)).toEqual([]);
  });

  test("reduced motion shows content immediately without transforms", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    const info = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".lp-reveal")];
      return {
        count: els.length,
        hidden: els.filter((e) => getComputedStyle(e).opacity !== "1").length,
        transformed: els.filter((e) => getComputedStyle(e).transform !== "none")
          .length,
        enter: getComputedStyle(document.querySelector(".lp-enter")!)
          .animationName,
      };
    });
    expect(info.count).toBeGreaterThan(0);
    expect(info.hidden).toBe(0);
    expect(info.transformed).toBe(0);
    expect(info.enter).toBe("none");
  });
});

test.describe("mobile 390", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });

  test("menu opens, traps focus, closes with Escape and after a link click", async ({
    page,
  }) => {
    await openHome(page);
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();
    const menu = page.getByRole("dialog", { name: "Site menu" });
    await expect(menu).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );
    // Tab never leaves the menu and its toggle.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () =>
          !!document.activeElement?.closest(
            '#lp-mobile-menu, header button[aria-controls="lp-mobile-menu"]',
          ),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await page.getByRole("button", { name: "Open menu" }).click();
    await menu.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/security$/);
    await expect(menu).toBeHidden();
  });

  test("no horizontal overflow and 44px menu targets", async ({ page }) => {
    await openHome(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    const heights = await page
      .locator("#lp-mobile-menu a")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);
  });

  test("axe: dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.addInitScript(() =>
      localStorage.setItem("qtesthub:theme", "dark"),
    );
    await openHome(page);
    await page.waitForLoadState("networkidle");
    expect(await axeFindings(page)).toEqual([]);
  });
});

test("rail keeps the right dot mid-section and when scrolling up; Quality Intelligence is reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  const current = page.locator('nav.lp-rail a[aria-current="location"]');
  await page.evaluate(() => {
    const top =
      document.getElementById("lp-features-title")!.getBoundingClientRect()
        .top + window.scrollY;
    window.scrollTo(0, top + 500); // deep inside the long Capabilities section
  });
  await expect(current).toHaveText("Capabilities");
  await page.evaluate(() => {
    const top =
      document.getElementById("lp-problem-title")!.getBoundingClientRect().top +
      window.scrollY;
    window.scrollTo(0, top - 60); // back up
  });
  await expect(current).toHaveText("The challenge");
  await page
    .locator("nav.lp-rail")
    .getByRole("link", { name: "Quality Intelligence" })
    .click();
  await expect(page.locator("#lp-intel-title")).toBeFocused();
  await expect(current).toHaveText("Quality Intelligence");
  await expect(
    page
      .getByRole("navigation", { name: "Home page sections" })
      .getByRole("link", { name: "Quality Intelligence" }),
  ).toHaveAttribute("href", "/#lp-intel-title");
});

for (const width of [390, 768]) {
  test(`compact sections pill at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openHome(page);
    const pill = page.getByRole("button", { name: "Sections" });
    await expect(pill).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 1800));
    await expect(pill).toBeVisible();
    const box = (await pill.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    const top = (await page
      .getByRole("button", { name: "Back to top" })
      .boundingBox())!;
    expect(box.x + box.width).toBeLessThan(top.x); // no overlap with back-to-top
    if (width === 390) {
      const cta = await page
        .locator('.lp-sticky-cta[data-visible="true"]')
        .boundingBox();
      expect(cta).not.toBeNull();
      expect(box.y + box.height).toBeLessThanOrEqual(cta!.y); // sits above the phone CTA
    }
    await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    const heights = await page
      .locator("#lp-sections-list a")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(10);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);
    await expect(
      page.locator('#lp-sections-list a[aria-current="location"]'),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#lp-sections-list")).toHaveCount(0);
    await expect(pill).toBeFocused();
    await pill.click();
    await page
      .locator("#lp-sections-list")
      .getByRole("link", { name: "Quality Intelligence" })
      .click();
    await expect(page.locator("#lp-intel-title")).toBeFocused();
    await expect(page.locator("#lp-sections-list")).toHaveCount(0);
  });
}

test("compact list shows every item at 390x844 and scrolls at 360x640", async ({
  page,
}) => {
  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ]) {
    await page.setViewportSize({ width, height });
    await openHome(page);
    await page.evaluate(() => window.scrollTo(0, 1800));
    await page.getByRole("button", { name: "Sections" }).click();
    const list = page.locator("#lp-sections-list");
    const { clipped, scrollable } = await list.evaluate((el) => {
      const last = el.querySelector("li:last-child a")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        clipped: last.bottom > box.bottom + 0.5,
        scrollable: el.scrollHeight > el.clientHeight + 1,
      };
    });
    if (height === 844) {
      expect(clipped).toBe(false);
      expect(scrollable).toBe(false);
    } else {
      expect(scrollable).toBe(true);
    }
  }
});

// ADR-101: the landing page's own default is Cobalt & Sunshine; any explicit saved
// theme still wins. Axe runs on every built-in theme at desktop and phone width.
test.describe("landing colour scheme (ADR-101)", () => {
  test("one primary call to action above the fold", async ({ page }) => {
    await openHome(page);
    await expect(page.locator(".lp-hero-home .lp-btn")).toHaveCount(1);
    await expect(page.locator(".lp-hero-home .lp-btn").first()).toHaveText(
      /Request a Demo/,
    );
  });

  for (const theme of ["cobalt", "sage", "dark", "indigo", "light"] as const) {
    for (const [width, height] of [
      [1280, 800],
      [768, 1024],
      [390, 844],
    ] as const) {
      if (width !== 1280 && theme !== "cobalt") continue;
      test(`axe and no horizontal overflow: ${theme} @${width}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript(
          (value) => localStorage.setItem("qtesthub:theme", value),
          theme,
        );
        await openHome(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.waitForLoadState("networkidle");
        expect(await axeFindings(page)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
