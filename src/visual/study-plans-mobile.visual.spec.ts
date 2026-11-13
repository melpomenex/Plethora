import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/src/visual/entries/study-plans-mobile-harness.html";

async function open(page: Page, width: number, query = "") {
  await page.setViewportSize({ width, height: 720 });
  await page.goto(`${HARNESS}${query}`);
  await expect(page.locator("[data-study-plans-scroll]").first()).toBeVisible();
}

async function noPageHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport);
}

for (const width of [320, 390, 768]) {
  test(`${width}px: create flows through keyboard clearance into editor sections`, async ({ page }) => {
    await open(page, width);
    await noPageHorizontalOverflow(page);
    await page.getByTestId("create-study-plan-btn").click();
    await page.getByLabel(/plan title/i).fill("Mobile cryptography learning plan");
    await page.getByLabel(/learning objective/i).fill("Understand secure computation and apply it to real systems.");

    // Simulate a reduced visual viewport while an input is focused. The app
    // publishes this keyboard height to the same CSS contract used by mobile.
    await page.getByLabel(/learning objective/i).focus();
    await page.setViewportSize({ width, height: 480 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-keyboard-height", "240px");
    });
    await expect(page.getByLabel(/learning objective/i)).toBeInViewport();

    const createScroll = page.locator('[data-study-plans-scroll="create"]');
    const beforeSubmit = await createScroll.evaluate((element) => {
      const scroll = element as HTMLElement;
      scroll.scrollTop = scroll.scrollHeight;
      const action = scroll.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const actionRect = action.getBoundingClientRect();
      const assistant = document.querySelector(".mobile-assistant-pill")!.getBoundingClientRect();
      const style = getComputedStyle(scroll);
      return {
        scrollable: scroll.scrollHeight > scroll.clientHeight,
        paddingBottom: parseFloat(style.paddingBottom),
        actionBottom: actionRect.bottom,
        assistantTop: assistant.top,
        pageScroll: document.scrollingElement?.scrollTop ?? 0,
      };
    });

    expect(beforeSubmit.scrollable).toBe(true);
    expect(beforeSubmit.paddingBottom).toBeGreaterThan(300);
    expect(beforeSubmit.actionBottom).toBeLessThan(beforeSubmit.assistantTop);
    expect(beforeSubmit.pageScroll).toBe(0);
    await noPageHorizontalOverflow(page);

    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--app-keyboard-height", "0px");
    });
    await page.getByRole("button", { name: "Create Draft Plan" }).click();
    const editorScroll = page.locator('[data-study-plans-scroll="editor"]');
    await expect(editorScroll).toBeVisible();
    const tabList = page.getByRole("tablist", { name: "Editor sections" });
    const lastTab = page.getByRole("tab", { name: "Evidence & Gaps" });
    const editorGeometry = await tabList.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    if (width < 768) expect(editorGeometry.scrollWidth).toBeGreaterThan(editorGeometry.clientWidth);
    for (const tab of await tabList.getByRole("tab").all()) {
      await tab.scrollIntoViewIfNeeded();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await noPageHorizontalOverflow(page);
    }
    await lastTab.scrollIntoViewIfNeeded();
    await expect(page.getByRole("heading", { name: /evidence & gaps/i })).toBeVisible();
  });
}

for (const width of [320, 768]) {
  test(`${width}px: plan home scrolls without page overflow`, async ({ page }) => {
    await open(page, width, "?view=plan-home");
    const homeScroll = page.locator('[data-study-plans-scroll="plan-home"]');
    await expect(homeScroll).toBeVisible();
    await noPageHorizontalOverflow(page);
    await homeScroll.evaluate((element) => {
      const scroll = element as HTMLElement;
      scroll.scrollTop = scroll.scrollHeight;
    });
    const lastAction = homeScroll.getByRole("button").last();
    await expect(lastAction).toBeInViewport();
    await noPageHorizontalOverflow(page);
  });
}

test("844×390 landscape: create action and editor sections stay reachable", async ({ page }) => {
  await open(page, 844);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId("create-study-plan-btn").click();
  await page.getByLabel(/plan title/i).fill("Landscape mobile study plan");
  await page.getByLabel(/learning objective/i).fill("Keep the complete workflow reachable in a short landscape viewport.");

  const createScroll = page.locator('[data-study-plans-scroll="create"]');
  await expect.poll(() => createScroll.evaluate((element) =>
    parseFloat(getComputedStyle(element).getPropertyValue("--study-plans-bottom-clearance")),
  )).toBeLessThan(200);
  await createScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    scroll.scrollTop = scroll.scrollHeight;
  });
  const createAction = page.getByRole("button", { name: "Create Draft Plan" });
  await expect(createAction).toBeInViewport();
  const actionGeometry = await createAction.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, assistantTop: document.querySelector(".mobile-assistant-pill")!.getBoundingClientRect().top };
  });
  expect(actionGeometry.bottom).toBeLessThan(actionGeometry.assistantTop);
  await noPageHorizontalOverflow(page);

  await createAction.click();
  const tabList = page.getByRole("tablist", { name: "Editor sections" });
  await expect(tabList).toBeVisible();
  const evidenceTab = page.getByRole("tab", { name: "Evidence & Gaps" });
  await evidenceTab.scrollIntoViewIfNeeded();
  await evidenceTab.click();
  await expect(evidenceTab).toHaveAttribute("aria-selected", "true");
  await noPageHorizontalOverflow(page);
});

test("320px: editor transitions into lesson and assessment builder", async ({ page }) => {
  await open(page, 320, "?view=editor");
  await page.setViewportSize({ width: 320, height: 520 });
  await page.getByRole("button", { name: "Start lesson for the selected topic" }).click();

  const lessonDialog = page.getByRole("dialog");
  await expect(lessonDialog).toBeVisible();
  const lessonBounds = await lessonDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  expect(lessonBounds.top).toBeGreaterThanOrEqual(0);
  expect(lessonBounds.bottom).toBeLessThanOrEqual(520);
  expect(lessonBounds.left).toBeGreaterThanOrEqual(0);
  expect(lessonBounds.right).toBeLessThanOrEqual(320);
  await page.getByRole("button", { name: "Close lesson" }).click();

  await page.getByRole("tab", { name: "Assessments" }).click();
  await page.getByRole("button", { name: "Create for all topics" }).click();
  const builderScroll = page.locator('[data-study-plans-scroll="assessment-builder"]');
  await expect(builderScroll).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Assessment title" })).toBeVisible();
  const builderSize = await builderScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    return { clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight };
  });
  expect(builderSize.scrollHeight).toBeGreaterThan(builderSize.clientHeight);
  await builderScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    scroll.scrollTop = scroll.scrollHeight;
  });
  await expect(builderScroll.getByRole("heading").last()).toBeInViewport();
  await noPageHorizontalOverflow(page);
});

test("320px: curriculum generator stays within a short mobile viewport", async ({ page }) => {
  await open(page, 320);
  await page.setViewportSize({ width: 320, height: 520 });
  await page.getByTestId("create-study-plan-btn").click();
  await page.getByLabel(/plan title/i).fill("Mobile curriculum generation plan");
  await page.getByLabel(/learning objective/i).fill("Understand secure computation and apply it to real systems.");
  await page.locator('input[name="creation-method"][value="ai"]').check();
  await page.getByRole("button", { name: /continue to ai generation/i }).click();

  const layer = page.locator(".adaptive-dialog-layer");
  const panel = page.locator(".adaptive-dialog-panel").last();
  await expect(layer).toBeVisible();
  const bounds = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const panelElement = element as HTMLElement;
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      scrollable: panelElement.scrollHeight > panelElement.clientHeight,
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(520);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(320);
  expect(bounds.scrollable).toBe(true);

  await panel.evaluate((element) => {
    (element as HTMLElement).scrollTop = (element as HTMLElement).scrollHeight;
  });
  await expect(panel.getByRole("button").last()).toBeInViewport();
  await noPageHorizontalOverflow(page);
});

test("320px: question editor footer remains reachable in a short viewport", async ({ page }) => {
  await open(page, 320, "?view=question-editor");
  await page.setViewportSize({ width: 320, height: 480 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--app-viewport-height", "240px");
    document.documentElement.style.setProperty("--app-viewport-offset-top", "12px");
  });
  const layer = page.locator(".adaptive-dialog-layer");
  const panel = page.locator(".adaptive-dialog-panel");
  const body = panel.locator(".adaptive-dialog-body");
  await expect(layer).toBeVisible();
  const bounds = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(12);
  expect(bounds.bottom).toBeLessThanOrEqual(252);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(320);

  await body.evaluate((element) => {
    (element as HTMLElement).scrollTop = (element as HTMLElement).scrollHeight;
  });
  const lastAction = panel.getByRole("button").last();
  await expect(lastAction).toBeInViewport();
  await noPageHorizontalOverflow(page);
});

for (const width of [320, 768]) {
  test(`${width}px: assessment controls reflow and keep touch targets`, async ({ page }) => {
    await open(page, width, "?view=assessment-controls");
    const scroll = page.locator('[data-study-plans-scroll="assessment-controls"]');
    await expect(scroll).toBeVisible();
    const modeButtons = page.getByRole("button", { name: /examination|practice|diagnostic/i });
    const modeSizes = await modeButtons.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, x: rect.x };
    }));
    expect(modeSizes).toHaveLength(3);
    expect(modeSizes.every((size) => size.height >= 44 && size.width >= 44)).toBe(true);
    if (width < 640) expect(modeSizes[0].x).toBeCloseTo(modeSizes[1].x, 0);
    else expect(modeSizes[0].x).toBeLessThan(modeSizes[1].x);

    const confidenceButtons = page.getByRole("radiogroup", { name: /confidence level/i }).getByRole("radio");
    const confidenceSizes = await confidenceButtons.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(confidenceSizes).toHaveLength(6);
    expect(confidenceSizes.every((size) => size.height >= 44 && size.width >= 44)).toBe(true);

    const compactTargets = await scroll.locator('button, select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height };
    }));
    expect(compactTargets.length).toBeGreaterThan(0);
    expect(compactTargets.every((target) => target.height >= 44)).toBe(true);
    await noPageHorizontalOverflow(page);
  });
}

test("320px: long history reaches results and resumes a long attempt", async ({ page }) => {
  await open(page, 320, "?view=history&audio=1");
  const historyScroll = page.locator('[data-study-plans-scroll="assessment-history"]');
  const historyGeometry = await historyScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    return {
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      bottomClearance: parseFloat(getComputedStyle(scroll).getPropertyValue("--study-plans-bottom-clearance")),
    };
  });
  expect(historyGeometry.scrollHeight).toBeGreaterThan(historyGeometry.clientHeight);
  expect(historyGeometry.bottomClearance).toBeGreaterThan(100);
  await noPageHorizontalOverflow(page);

  await historyScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    scroll.scrollTop = scroll.scrollHeight;
  });
  await page.getByRole("button", { name: /resume attempt/i }).click();
  await expect(page.getByRole("main", { name: "Examination Session" })).toBeVisible();

  const runnerScroll = page.locator('[data-study-plans-scroll="attempt-runner"]');
  await runnerScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    scroll.scrollTop = scroll.scrollHeight;
  });
  const lastQuestion = runnerScroll.locator('[role="group"] button').last();
  await lastQuestion.click();
  await expect(lastQuestion).toHaveAttribute("aria-current", "true");
  await noPageHorizontalOverflow(page);

  await runnerScroll.evaluate((element) => { (element as HTMLElement).scrollTop = 0; });
  await page.getByRole("button", { name: "Submit" }).click();
  const submitLayer = page.locator(".adaptive-dialog-layer");
  const submitPanel = page.locator(".adaptive-dialog-panel").last();
  await expect(submitLayer).toBeVisible();
  const panelRect = await submitPanel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  expect(panelRect.top).toBeGreaterThanOrEqual(0);
  expect(panelRect.bottom).toBeLessThanOrEqual(720);
  expect(panelRect.left).toBeGreaterThanOrEqual(0);
  expect(panelRect.right).toBeLessThanOrEqual(320);
  await expect(page.getByRole("button", { name: /review questions/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /confirm & submit/i })).toBeVisible();
  await page.getByRole("button", { name: /review questions/i }).click();

  await page.getByRole("button", { name: /exit assessment/i }).click();
  await expect(historyScroll).toBeVisible();
  await historyScroll.evaluate((element) => { (element as HTMLElement).scrollTop = 0; });
  await page.getByRole("button", { name: /view results/i }).first().click();
  await expect(page.getByRole("main", { name: "Examination Results" })).toBeVisible();

  const resultsScroll = page.locator('[data-study-plans-scroll="attempt-results"]');
  const finalPrompt = page.getByText("Question 20: Which design choice", { exact: false });
  await resultsScroll.evaluate((element) => {
    const scroll = element as HTMLElement;
    scroll.scrollTop = scroll.scrollHeight;
  });
  await expect(finalPrompt).toBeInViewport();
  await noPageHorizontalOverflow(page);
});
