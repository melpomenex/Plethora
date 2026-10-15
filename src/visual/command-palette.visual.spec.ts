import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    paletteHarness: {
      setState: (patch: Record<string, unknown>) => void;
      setSearchFails: (fails: boolean) => void;
      setTheme: (themeId: string) => void;
    };
  }
}

/**
 * Command hub visual + functional acceptance (revamp-command-palette, 10.1/10.2).
 *
 * Geometry targets come from the measured reference recorded in the change
 * design (`openspec/changes/revamp-command-palette/design.md`): panel
 * 838 × 738 at x ≈ 376 / y ≈ 120, field 812 × 61 at x ≈ 389 / y ≈ 132,
 * scope pills at y ≈ 212, tile row at y ≈ 299–444, resume card 802 × 190 at
 * x ≈ 394 / y ≈ 495, cover 106 × 156 at x ≈ 414 / y ≈ 512, inset 233 × 157 at
 * x ≈ 949 / y ≈ 511, prompt rows at y ≈ 743 and ≈ 795.
 *
 * Every deterministic fixture lives in `src/visual/commandPaletteHarness.tsx`
 * (fixed clock/font/data, no production stores). The palette material derives
 * from the active theme; captures are taken under the deep-sea scenic theme
 * (biolume-abyss, the app default before Obsidian Noir) and under
 * gold-on-black (obsidian-noir, the current app default, which reproduces
 * the preserved reference's material). All captures also land in
 * `.playwright/results/` for the evidence record; the default desktop, the
 * obsidian desktop, and the phone sheet additionally carry committed
 * snapshot baselines.
 */

const RESULTS_DIR = ".playwright/results";

async function box(page: Page, selector: string) {
  const element = page.locator(selector).first();
  await element.waitFor();
  const bounds = await element.boundingBox();
  if (!bounds) throw new Error(`no bounding box for ${selector}`);
  return bounds;
}

async function openHub(page: Page, viewport = { width: 1586, height: 992 }) {
  await page.setViewportSize(viewport);
  await page.goto("/command-palette-harness.html");
  await page.getByRole("combobox").waitFor();
  await expect(page.getByText("Quick Actions")).toBeVisible();
  // Wait for the lazily-loaded theme catalog + applied material (biolume-abyss
  // primary #06b6d4) so captures are not caught mid-theme-swap.
  await waitForTheme(page, "rgb(6, 182, 212)");
}

/** Polls until the selected chip wears the given theme's primary color. */
async function waitForTheme(page: Page, primaryRgb: string) {
  await expect
    .poll(
      async () =>
        page
          .locator('.ch-scope[aria-selected="true"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      { timeout: 15000 }
    )
    .toBe(primaryRgb);
}

test.describe("reference geometry (1586 × 992)", () => {
  test.beforeEach(async ({ page }) => {
    await openHub(page);
  });
  test("panel, field, scope pills, tiles, resume card, and prompt grid match the measured reference", async ({ page }) => {
    const panel = await box(page, ".command-hub-panel");
    expect(Math.abs(panel.width - 838)).toBeLessThanOrEqual(4);
    expect(Math.abs(panel.height - 738)).toBeLessThanOrEqual(4);
    expect(Math.abs(panel.x - 376)).toBeLessThanOrEqual(4);
    expect(Math.abs(panel.y - 120)).toBeLessThanOrEqual(4);

    const field = await box(page, ".ch-field");
    expect(Math.abs(field.width - 812)).toBeLessThanOrEqual(4);
    expect(Math.abs(field.height - 61)).toBeLessThanOrEqual(4);
    expect(Math.abs(field.x - 389)).toBeLessThanOrEqual(4);
    expect(Math.abs(field.y - 132)).toBeLessThanOrEqual(4);

    // Scope pills: All first, six exclusive chips, ~32 px tall at y ≈ 212.
    const scopeChips = page.locator(".ch-scope");
    await expect(scopeChips).toHaveCount(6);
    const allChip = await box(page, '.ch-scope[aria-selected="true"]');
    expect(Math.abs(allChip.x - 395)).toBeLessThanOrEqual(4);
    expect(Math.abs(allChip.y - 212)).toBeLessThanOrEqual(4);
    expect(Math.abs(allChip.height - 32)).toBeLessThanOrEqual(4);

    const tiles = await box(page, ".ch-tiles");
    expect(Math.abs(tiles.y - 299)).toBeLessThanOrEqual(4);
    expect(Math.abs(tiles.height - 145)).toBeLessThanOrEqual(4);
    await expect(page.locator(".ch-tile")).toHaveCount(6);
    expect(Math.abs(tiles.width - 802)).toBeLessThanOrEqual(4);
    expect(Math.abs(tiles.x - 394)).toBeLessThanOrEqual(4);

    const resumeCard = await box(page, ".ch-resume");
    expect(Math.abs(resumeCard.x - 394)).toBeLessThanOrEqual(4);
    expect(Math.abs(resumeCard.y - 495)).toBeLessThanOrEqual(4);
    expect(Math.abs(resumeCard.width - 802)).toBeLessThanOrEqual(4);
    expect(Math.abs(resumeCard.height - 190)).toBeLessThanOrEqual(4);

    const cover = await box(page, ".ch-cover");
    expect(Math.abs(cover.x - 414)).toBeLessThanOrEqual(4);
    expect(Math.abs(cover.y - 512)).toBeLessThanOrEqual(4);
    expect(Math.abs(cover.width - 106)).toBeLessThanOrEqual(4);
    expect(Math.abs(cover.height - 156)).toBeLessThanOrEqual(4);

    const inset = await box(page, ".ch-resume-inset");
    expect(Math.abs(inset.x - 949)).toBeLessThanOrEqual(4);
    expect(Math.abs(inset.y - 511)).toBeLessThanOrEqual(4);
    expect(Math.abs(inset.width - 233)).toBeLessThanOrEqual(4);
    expect(Math.abs(inset.height - 157)).toBeLessThanOrEqual(4);

    // Two-by-two prompt grid with ~42 px rows at y ≈ 743 / 795.
    const prompts = page.locator(".ch-suggestions .ch-suggestion");
    await expect(prompts).toHaveCount(4);
    const promptBoxes = await prompts.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })
    );
    expect(Math.abs(promptBoxes[0].y - 743)).toBeLessThanOrEqual(4);
    expect(Math.abs(promptBoxes[1].y - 743)).toBeLessThanOrEqual(4);
    expect(Math.abs(promptBoxes[2].y - 795)).toBeLessThanOrEqual(4);
    expect(Math.abs(promptBoxes[3].y - 795)).toBeLessThanOrEqual(4);
    expect(Math.abs(promptBoxes[0].height - 42)).toBeLessThanOrEqual(4);
    // Two columns: second prompt starts right of the first.
    expect(promptBoxes[1].x).toBeGreaterThan(promptBoxes[0].x + promptBoxes[0].width - 8);

    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-default-1586.png` });
    await expect(page).toHaveScreenshot("command-palette-default-1586.png");
  });

  test("reference chrome stays local to the overlay", async ({ page }) => {
    // The backdrop behind the palette is the active theme's own root
    // background, and opening the palette must not alter the global theme:
    // the applied theme attributes and root colors stay untouched.
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
    ).toBe("rgb(2, 11, 20)"); // biolume-abyss background
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
    expect(
      await page.evaluate(() => document.documentElement.getAttribute("data-theme-animation"))
    ).toBe("bioglow");
    // Real modal behavior: the app root is inert and background scroll is
    // locked while the palette is open.
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  });

  test("material follows the chosen theme", async ({ page }) => {
    await openHub(page);
    // Biolume Abyss (the app default before Obsidian Noir): cyan accent on
    // the deep-sea surface.
    const defaultChip = await page
      .locator('.ch-scope[aria-selected="true"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(defaultChip).toBe("rgb(6, 182, 212)");
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-theme-default.png` });

    // Gold-on-black (obsidian-noir) reproduces the preserved reference
    // material while keeping the same composition.
    await page.evaluate(() => window.paletteHarness.setTheme("obsidian-noir"));
    await waitForTheme(page, "rgb(232, 168, 64)");
    const obsidianPanel = await page
      .locator(".command-hub-panel")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // Near-black surface (obsidian family), not the default deep blue.
    const obsidianLuma =
      obsidianPanel.match(/\d+/g)!.slice(0, 3).reduce((acc, v) => acc + Number(v), 0) / 3;
    expect(obsidianLuma).toBeLessThan(40);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-theme-obsidian.png` });
    await expect(page).toHaveScreenshot("command-palette-obsidian-1586.png");

    // Light theme (snow): light surface + steel-blue accent, still readable.
    await page.evaluate(() => window.paletteHarness.setTheme("snow"));
    await waitForTheme(page, "rgb(94, 129, 172)");
    const snowPanel = await page
      .locator(".command-hub-panel")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const snowLuma =
      snowPanel.match(/\d+/g)!.slice(0, 3).reduce((acc, v) => acc + Number(v), 0) / 3;
    expect(snowLuma).toBeGreaterThan(200);
    const snowText = await page
      .locator(".ch-resume-title")
      .evaluate((el) => getComputedStyle(el).color);
    const snowTextLuma =
      snowText.match(/\d+/g)!.slice(0, 3).reduce((acc, v) => acc + Number(v), 0) / 3;
    expect(snowTextLuma).toBeLessThan(120);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-theme-snow.png` });

    // Warm light gold (golden-hour) for a second non-default family.
    await page.evaluate(() => window.paletteHarness.setTheme("golden-hour"));
    await waitForTheme(page, "rgb(212, 145, 62)");
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-theme-golden-hour.png` });
  });

  test("URL input shows the import preview and Escape restores the previous scope", async ({ page }) => {
    await openHub(page);
    // Cards selected first; URL mode must win over the scope and Escape must
    // return to the Cards empty-input view.
    await page.getByRole("tab", { name: /Cards/ }).click();
    const input = page.getByRole("combobox");
    await input.fill("https://example.com/article");
    await expect(page.locator(".ch-url-section")).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-url-import.png` });

    await page.keyboard.press("Escape");
    await expect(page.locator(".ch-url-section")).toHaveCount(0);
    await expect(input).toHaveValue("");
    await expect(page.getByRole("tab", { name: /Cards/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("view all opens from the palette-local shortcut and keeps the input", async ({ page }) => {
    const input = page.getByRole("combobox");
    await input.fill("doc");
    await page.keyboard.press("Control+/");
    await expect(
      page.locator(".ch-results").getByText("Go to Documents", { exact: true })
    ).toBeVisible();
    await expect(input).toHaveValue("doc");
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-view-all.png` });
  });

  test("search results render with a group header and a secondary-hit detail region", async ({ page }) => {
    const input = page.getByRole("combobox");
    await input.fill("fascism");
    await expect(page.getByText("The-Doctrine-of-Fascism").first()).toBeVisible();
    const options = page.locator('.ch-results [role="option"]');
    await expect(options).toHaveCount(3);
    // Hovering the document with several matches selects it and exposes its
    // secondary hits in a separate (non-nested) detail region.
    await options.nth(1).hover();
    await expect(page.locator(".ch-detail-hit")).toHaveCount(2);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-search-results.png` });
  });

  test("home actions dispatch exactly once from keyboard activation", async ({ page }) => {
    const input = page.getByRole("combobox");
    await input.focus();
    await page.keyboard.press("Enter");
    const dispatches = await page.evaluate(
      () => (window as unknown as { __paletteDispatches?: unknown[] }).__paletteDispatches ?? []
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ id: "palette.resume" });
  });

  test("keyboard focus stays inside the dialog while tabbing", async ({ page }) => {
    await page.getByRole("combobox").focus();
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        Boolean(document.activeElement?.closest(".command-hub-panel"))
      );
      expect(inside).toBe(true);
    }
  });
});

test.describe("functional states", () => {
  test("note composer captures a draft and resumes it after Escape", async ({ page }) => {
    await openHub(page);
    await page.getByText("Create a note").click();
    const body = page.getByLabel("Note body");
    await body.waitFor();
    await expect(body).toBeFocused();
    await page.getByLabel("Title").fill("Reading notes");
    await body.fill("A thought captured from the palette.");
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-note.png` });

    await page.keyboard.press("Escape");
    await expect(body).not.toBeVisible();
    await expect(page.getByText("Quick Actions")).toBeVisible();

    await page.getByText("Create a note").click();
    await expect(page.getByLabel("Note body")).toHaveValue("A thought captured from the palette.");
    await expect(page.getByLabel("Title")).toHaveValue("Reading notes");
  });

  test("first-run library explains unavailable resume actions", async ({ page }) => {
    await openHub(page);
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setState: (p: unknown) => void } }).paletteHarness.setState({
        resume: false,
        firstUse: true,
      })
    );
    await expect(page.getByText("Your library is empty")).toBeVisible();
    await expect(page.getByText("Nothing in progress yet")).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-first-run.png` });
  });

  test("zero due cards show a caught-up state without a badge", async ({ page }) => {
    await openHub(page);
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setState: (p: unknown) => void } }).paletteHarness.setState({
        due: 0,
      })
    );
    await expect(page.getByText("You're caught up")).toBeVisible();
    await expect(page.locator(".ch-tile-badge")).toHaveCount(0);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-caught-up.png` });
  });

  test("unavailable assistant explains the missing capability", async ({ page }) => {
    await openHub(page);
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setState: (p: unknown) => void } }).paletteHarness.setState({
        assistant: false,
      })
    );
    await expect(page.getByText(/Assistant unavailable/)).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-assistant-unavailable.png` });
  });

  test("resume enrichment loading keeps a stable skeleton footprint", async ({ page }) => {
    await openHub(page);
    const before = await box(page, ".ch-resume");
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setState: (p: unknown) => void } }).paletteHarness.setState({
        resumeLoading: true,
      })
    );
    await expect(page.locator(".ch-resume--loading")).toBeVisible();
    const during = await box(page, ".ch-resume");
    expect(Math.abs(before.width - during.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(before.y - during.y)).toBeLessThanOrEqual(4);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-resume-loading.png` });
  });

  test("search provider failure keeps the query and offers Retry", async ({ page }) => {
    await openHub(page);
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setSearchFails: (f: boolean) => void } }).paletteHarness.setSearchFails(true)
    );
    const input = page.getByRole("combobox");
    await input.fill("fascism");
    await expect(page.getByText("Search is unavailable right now")).toBeVisible({ timeout: 5000 });
    await expect(input).toHaveValue("fascism");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-search-error.png` });
  });

  test("supported-view contextual actions appear before the general hub content", async ({ page }) => {
    await openHub(page);
    await page.evaluate(() =>
      (window as unknown as { paletteHarness: { setState: (p: unknown) => void } }).paletteHarness.setState({
        contextual: true,
      })
    );
    const contextualHeading = await box(page, '.ch-section[aria-label="Actions in this view"]');
    const quickHeading = await box(page, '.ch-section[aria-label="Quick Actions"]');
    expect(contextualHeading.y).toBeLessThan(quickHeading.y);
    await expect(page.getByText("Search in Document")).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-contextual.png` });
  });

  test("reduced motion and 200% zoom keep the hub usable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Browser zoom reduces the CSS-pixel viewport: 1586 × 992 at 200% is
    // 793 × 496, so the content-driven breakpoints are what a zoomed user sees.
    await openHub(page, { width: 793, height: 496 });
    await expect(page.getByRole("combobox")).toBeVisible();
    await expect(page.getByRole("tab", { name: /All/ })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-zoom200.png` });
  });
});

test.describe("responsive layouts", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    test(`desktop ${viewport.width} × ${viewport.height} keeps six tiles`, async ({ page }) => {
      await openHub(page, viewport);
      await expect(page.locator(".ch-tile")).toHaveCount(6);
      const columns = await page
        .locator(".ch-tiles")
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(6);
      const panel = await box(page, ".command-hub-panel");
      expect(panel.x).toBeGreaterThanOrEqual(16);
      expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width - 16);
      await page.screenshot({
        path: `${RESULTS_DIR}/command-palette-${viewport.width}x${viewport.height}.png`,
      });
    });
  }

  test("short desktop scrolls the body instead of shrinking text", async ({ page }) => {
    await openHub(page, { width: 1586, height: 620 });
    await expect(page.getByRole("combobox")).toBeVisible();
    const bodyScrolls = await page
      .locator(".ch-body")
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(bodyScrolls).toBe(true);
    // Scroll the deepest content into view.
    await page.locator(".ch-suggestion").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".ch-suggestion").last()).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-short-desktop.png` });
  });

  test("tablet 768 × 1024 reflows to three tile columns and stacks the inset", async ({ page }) => {
    await openHub(page, { width: 768, height: 1024 });
    const columns = await page
      .locator(".ch-tiles")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(3);
    const cover = await box(page, ".ch-cover");
    const inset = await box(page, ".ch-resume-inset");
    expect(inset.y).toBeGreaterThan(cover.y + cover.height - 4);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-768x1024.png` });
  });

  test("phone 390 × 844 uses a sheet with two-column tiles and one-column prompts", async ({ page }) => {
    await openHub(page, { width: 390, height: 844 });
    const tileColumns = await page
      .locator(".ch-tiles")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(tileColumns).toBe(2);
    const promptColumns = await page
      .locator(".ch-suggestions")
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(promptColumns).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("combobox")).toBeVisible();
    // Every scope chip stays reachable via the horizontal strip.
    await page.locator(".ch-scope-tabs").evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(page.getByRole("tab", { name: /Settings/ })).toBeVisible();
    await expect(page.getByText("View all")).toBeVisible();
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-phone.png` });
    await expect(page).toHaveScreenshot("command-palette-phone-390.png");
  });

  test("phone with software keyboard (390 × 520) keeps input and scopes visible", async ({ page }) => {
    await openHub(page, { width: 390, height: 520 });
    await expect(page.getByRole("combobox")).toBeVisible();
    await expect(page.getByRole("tab", { name: /All/ })).toBeVisible();
    const bodyScrolls = await page
      .locator(".ch-body")
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(bodyScrolls).toBe(true);
    await page.screenshot({ path: `${RESULTS_DIR}/command-palette-phone-keyboard.png` });
  });
});
