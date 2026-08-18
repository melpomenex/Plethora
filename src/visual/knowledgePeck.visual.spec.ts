import { expect, test } from "@playwright/test";

/**
 * Knowledge Peck startup animation visual regression (task 10.2, change
 * knowledge-peck-startup-animation).
 *
 * Runs against the dev server. Scenes are pinned with the DEV-only freeze
 * hook (`?kp-stage=<stage>&kp-freeze=1`, honored only under
 * import.meta.env.DEV) so every screenshot is timing-insensitive — same
 * philosophy as the PDF-reflow harness. Baselines live in
 * src/visual/__snapshots__; a first run creates them, later runs gate at 2%
 * pixel diff.
 *
 * Matrix: {fragments, connected, resolve/idle} × {1280×800, 390×844}, plus a
 * reduced-motion frame (page.emulateMedia) and an e-ink still (seeded
 * `plethora-display-mode` localStorage; the overlay's white-surface repaint
 * and its stepped stills are deterministic there).
 */

const VIEWPORTS = [
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
] as const;

/** fragments / connected (peck-2) / resolve-idle — exists in both scripts. */
const STAGES = ["fragments", "peck-2", "idle"] as const;

async function openFrozenScene(
  page: import("@playwright/test").Page,
  stage: string
): Promise<import("@playwright/test").Locator> {
  await page.goto(`/?kp-stage=${stage}&kp-freeze=1#/`);
  // The freeze branch stamps data-kp-stage in its first rAF after mount; the
  // same frame writes the sampled transforms, so the attribute is the
  // ready-to-photograph signal.
  const overlay = page.locator(`.kp-overlay[data-kp-stage="${stage}"]`);
  await overlay.waitFor({ state: "visible", timeout: 30_000 });
  // The app boots behind the opaque overlay; give the wordmark font a moment
  // to settle so baselines are stable.
  await page.waitForTimeout(400);
  return overlay;
}

test.describe("knowledge peck frozen scenes", () => {
  for (const viewport of VIEWPORTS) {
    for (const stage of STAGES) {
      test(`${stage} at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        const overlay = await openFrozenScene(page, stage);
        await expect(overlay).toHaveScreenshot(`kp-${stage}-${viewport.name}.png`);
      });
    }
  }
});

test.describe("variant frames", () => {
  test("reduced-motion static variant (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const overlay = await openFrozenScene(page, "idle");
    await expect(overlay.getAttribute("data-variant")).resolves.toBe(
      "reduced-motion",
    );
    await expect(overlay).toHaveScreenshot("kp-reduced-motion-desktop-1280.png");
  });

  test("e-ink stepped still (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("plethora-display-mode", "eink");
    });
    const overlay = await openFrozenScene(page, "idle");
    await expect(overlay.getAttribute("data-variant")).resolves.toBe("eink");
    // Still 2 of 3 (mascot + connected cards): steps land at ~450/900 ms.
    await page.waitForTimeout(600);
    await expect(overlay).toHaveScreenshot("kp-eink-desktop-1280.png");
  });
});
