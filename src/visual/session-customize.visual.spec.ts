/**
 * Layering contract for the New Queue dialog (see
 * `openspec/changes/fix-session-customize-mobile-layering`).
 *
 * The dialog used to be `fixed inset-0 z-50` inside the tab content while the
 * mobile bottom navigation is `z-index: 1000`, so the navigation painted over
 * the dialog's footer and kept taking taps. These checks run the real dialog
 * over a navigation stand-in with the nav's exact geometry and z-index.
 */
import { expect, test, type Page } from "@playwright/test";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 1000 };

/** Footer actions that must each be reachable on a phone. */
const PHONE_ACTIONS = [
  "Reset to Defaults",
  "Save as New Queue",
  "Update Queue",
  "Cancel",
  "Apply Customization",
];

async function openDialog(page: Page) {
  await page.goto("/session-customize-harness.html");
  await page.getByRole("button", { name: "New Queue", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("phone: the dialog layer outranks the navigation and covers it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDialog(page);

  const geometry = await page.evaluate(() => {
    const layer = document.querySelector(".adaptive-dialog-layer")!;
    const panel = document.querySelector(".adaptive-dialog-panel")!;
    const toolbar = document.querySelector("#bottom-toolbar")!;
    const toolbarRect = toolbar.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    // A point inside the navigation band: the scrim must own it, not the nav.
    const probe = document.elementFromPoint(
      toolbarRect.x + toolbarRect.width / 2,
      toolbarRect.y + 20,
    );
    return {
      layerZ: Number(getComputedStyle(layer).zIndex),
      toolbarZ: Number(getComputedStyle(toolbar).zIndex),
      sheetForm: Boolean(document.querySelector(".adaptive-dialog-sheet")),
      panelBottom: panelRect.bottom,
      panelTop: panelRect.top,
      toolbarTop: toolbarRect.top,
      viewportHeight: window.innerHeight,
      probeOwnedByToolbar: Boolean(probe?.closest("#bottom-toolbar")),
      probeOwnedByLayer: Boolean(probe?.closest(".adaptive-dialog-layer")),
    };
  });

  expect(geometry.layerZ).toBeGreaterThan(geometry.toolbarZ);
  expect(geometry.sheetForm).toBe(true);
  // The surface reaches into the navigation band instead of stopping above it.
  expect(geometry.panelBottom).toBeGreaterThan(geometry.toolbarTop);
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.panelTop).toBeGreaterThanOrEqual(0);
  // The scrim, not the navigation, receives a tap where a destination sits.
  expect(geometry.probeOwnedByToolbar).toBe(false);
  expect(geometry.probeOwnedByLayer).toBe(true);

  // No action is clipped or covered: each is its own hit target at its center.
  const actions = await page.evaluate((labels) => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".adaptive-dialog-footer button"),
    );
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    return labels.map((label) => {
      const button = buttons.find((candidate) =>
        (candidate.textContent ?? "").includes(label),
      );
      if (!button) return { label, found: false };
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return {
        label,
        found: true,
        height: rect.height,
        insideViewport:
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= viewportHeight &&
          rect.right <= viewportWidth,
        hit: Boolean(top && (top === button || button.contains(top))),
      };
    });
  }, PHONE_ACTIONS);

  for (const action of actions) {
    expect(action.found, `${action.label} is rendered`).toBe(true);
    expect(action.insideViewport, `${action.label} is inside the viewport`).toBe(true);
    expect(action.hit, `${action.label} is its own hit target`).toBe(true);
    expect(action.height ?? 0, `${action.label} meets the touch minimum`).toBeGreaterThanOrEqual(44);
  }

  // Scrolling the body to its end keeps the actions in view: the surface owns
  // its own scrolling and does not chain to the page beneath.
  const afterScroll = await page.evaluate(() => {
    const body = document.querySelector(".adaptive-dialog-body")!;
    body.scrollTop = body.scrollHeight;
    const footer = document.querySelector(".adaptive-dialog-footer")!.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const apply = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".adaptive-dialog-footer button"),
    ).find((button) => (button.textContent ?? "").includes("Apply Customization"))!;
    const rect = apply.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      footerVisible: footer.top >= 0 && footer.bottom <= viewportHeight,
      applyStillHit: Boolean(top && (top === apply || apply.contains(top))),
      pageScroll: document.scrollingElement?.scrollTop ?? 0,
    };
  });
  expect(afterScroll.footerVisible).toBe(true);
  expect(afterScroll.applyStillHit).toBe(true);
  expect(afterScroll.pageScroll).toBe(0);

  await page.screenshot({ path: ".playwright/results/session-customize-phone-390.png" });
});

test("phone: the navigation stays inert until the dialog is dismissed", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDialog(page);

  const toolbar = (await page.locator("#toolbar-destination").boundingBox())!;
  await page.mouse.click(toolbar.x + toolbar.width / 2, toolbar.y + toolbar.height / 2);

  // The tap landed on the dialog surface that covers the navigation band: the
  // destination behind it never saw the click and the dialog stayed open.
  expect(await page.evaluate(() => window.sessionCustomizeHarness.toolbarClicks)).toBe(0);
  expect(await page.evaluate(() => window.sessionCustomizeHarness.destination)).toBe("queue");
  await expect(page.getByRole("dialog")).toBeVisible();

  // The scrim beside the sheet still dismisses it (a strip of the layer's
  // padding, outside the panel's bounds).
  await page.mouse.click(6, 400);
  await expect(page.getByRole("dialog")).toBeHidden();

  // After dismissal the same destination works again.
  await page.locator("#toolbar-destination").click();
  expect(await page.evaluate(() => window.sessionCustomizeHarness.toolbarClicks)).toBe(1);
  expect(await page.evaluate(() => window.sessionCustomizeHarness.destination)).toBe("documents");
  await expect(page.locator("#destination-label")).toHaveText("destination: documents");
});

test("phone: the queue name entry stays inside the visible viewport", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDialog(page);

  await page.getByRole("button", { name: "Save as New Queue" }).click();
  const input = page.getByPlaceholder(/queue name/i);
  await expect(input).toBeVisible();

  // A keyboard opens: the visual viewport shrinks without the layout viewport
  // shrinking on several mobile browsers.
  await page.setViewportSize({ width: PHONE.width, height: 420 });

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
        const required = [".adaptive-dialog-footer"];
        return required.every((selector) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= visibleHeight + 0.5;
        });
      }),
    )
    .toBe(true);

  const entry = await page.evaluate(() => {
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight;
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder*="Queue name"]',
    )!;
    const rect = input.getBoundingClientRect();
    const save = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".adaptive-dialog-footer button"),
    ).filter((button) => (button.textContent ?? "").trim() === "Save");
    return {
      inputVisible: rect.top >= 0 && rect.bottom <= visibleHeight,
      saveVisible: save.length === 1 &&
        save[0].getBoundingClientRect().bottom <= visibleHeight,
    };
  });
  expect(entry.inputVisible).toBe(true);
  expect(entry.saveVisible).toBe(true);
  await expect(input).toBeFocused();

  await page.screenshot({ path: ".playwright/results/session-customize-phone-keyboard.png" });
});

test("desktop: the dialog is centered and keeps the single action row", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openDialog(page);

  const geometry = await page.evaluate(() => {
    const layer = document.querySelector(".adaptive-dialog-layer")!;
    const panel = document.querySelector(".adaptive-dialog-panel")!;
    const toolbar = document.querySelector("#bottom-toolbar")!;
    const panelRect = panel.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const probe = document.elementFromPoint(
      toolbarRect.x + toolbarRect.width / 2,
      toolbarRect.y + 20,
    );
    return {
      layerZ: Number(getComputedStyle(layer).zIndex),
      toolbarZ: Number(getComputedStyle(toolbar).zIndex),
      centeredForm: panel.classList.contains("adaptive-dialog-centered"),
      sheetForm: panel.classList.contains("adaptive-dialog-sheet"),
      // A centered dialog must clear the navigation band entirely.
      panelBottom: panelRect.bottom,
      toolbarTop: toolbarRect.top,
      probeOwnedByToolbar: Boolean(probe?.closest("#bottom-toolbar")),
      layerTop: layer.getBoundingClientRect().top,
    };
  });

  expect(geometry.layerZ).toBeGreaterThan(geometry.toolbarZ);
  expect(geometry.centeredForm).toBe(true);
  expect(geometry.sheetForm).toBe(false);
  expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.toolbarTop);
  expect(geometry.probeOwnedByToolbar).toBe(false);
  expect(geometry.layerTop).toBe(0);

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(".adaptive-dialog-footer button"))
      .map((button) => (button.textContent ?? "").trim())
      .filter(Boolean),
  );
  expect(labels).toEqual([
    "Reset to Defaults",
    "Save as New Queue",
    "Update Queue (All Due)",
    "Cancel",
    "Apply Customization",
  ]);

  await page.screenshot({ path: ".playwright/results/session-customize-desktop-1440.png" });
});
