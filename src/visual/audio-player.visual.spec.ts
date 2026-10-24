import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`audio survives source close, navigation and expansion at ${mobile ? "320px" : "1280px"}`, async ({ page }) => {
    page.on("pageerror", error => { console.error("audio fixture:", error.message); });
    await page.setViewportSize(mobile ? { width: 320, height: 740 } : { width: 1280, height: 720 });
    await page.goto(`/audio-player-harness.html${mobile ? "?mobile" : ""}`);
    await page.getByRole("button", { name: "Play fixture", exact: true }).click();
    const player = page.getByRole("region", { name: "Audio player" });
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close source tab" }).click();
    await expect(page.getByTestId("source-view")).toHaveCount(0);
    for (const destination of ["Reader", "Notes", "Review"]) await page.getByRole("button", { name: destination, exact: true }).click();
    await page.getByRole("button", { name: "Reveal answer" }).click();
    await player.getByRole("button", { name: "Expand audio player" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add bookmark", exact: true })).toBeVisible();
    await page.getByLabel("Bookmark title", { exact: true }).fill("A real saved bookmark");
    await page.getByRole("button", { name: "Add bookmark", exact: true }).click();
    await expect(page.getByText("Bookmark saved", { exact: true })).toBeVisible();
    await page.getByRole("dialog").evaluate(element => { const scroller = element.querySelector(".overflow-y-auto"); if (scroller) scroller.scrollTop = 0; });
    await page.screenshot({ path: `.playwright/results/global-audio-expanded-${mobile ? "mobile" : "desktop"}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("The application owner")).toBeVisible();
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const transport = await player.getByRole("group", { name: "Playback controls" }).boundingBox();
    expect(transport!.x).toBeGreaterThanOrEqual(0);
    expect(transport!.x + transport!.width).toBeLessThanOrEqual(mobile ? 320 : 1280);
    const state = await page.evaluate(async () => {
      const url = "/src/services/audio/audioRuntime.ts";
      const owner = (await import(/* @vite-ignore */ url)).getGlobalAudioController();
      return owner.getSnapshot();
    });
    expect(state.sourceKey.sourceId).toBe("audio-owner-fixture");
    expect(state.generation).toBe(1);
    expect(state.playIntent).toBe(true);
    await page.screenshot({ path: `.playwright/results/global-audio-${mobile ? "mobile" : "desktop"}.png` });
    await player.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const url = "/src/stores/audioPlaybackStore.ts";
      (await import(/* @vite-ignore */ url)).useAudioPlaybackStore.setState({ storageError: "Synthetic storage failure: retry saving" });
    });
    await expect(player.getByRole("button", { name: /^Expand audio player:/ })).toHaveAccessibleDescription("Audio needs attention");
    await page.screenshot({ path: `.playwright/results/global-audio-error-${mobile ? "mobile" : "desktop"}.png` });
  });
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
]) {
  for (const zoom of [1, 1.25, 1.5]) {
    // WebKitGTK/browser interface zoom reduces the CSS viewport (1280x720 at
    // 150% lays out as 853x480 CSS px); emulate that layout viewport rather
    // than applying CSS `zoom`, which magnifies and overflows the page.
    const layout = { width: Math.floor(viewport.width / zoom), height: Math.floor(viewport.height / zoom) };
    test(`desktop dock stays contained and reserved at ${viewport.width}x${viewport.height} @ ${zoom * 100}%`, async ({ page }) => {
      await page.setViewportSize(layout);
      await page.goto("/audio-player-harness.html");
      await page.getByRole("button", { name: "Play fixture", exact: true }).click();
      const player = page.getByRole("region", { name: "Audio player" });
      await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

      const dock = await player.boundingBox();
      expect(dock!.height).toBeGreaterThan(0);
      expect(dock!.height).toBeLessThanOrEqual(72);
      expect(dock!.height).toBeLessThanOrEqual(layout.height / 3);
      for (const name of ["Back 30 seconds", "Pause", "Forward 30 seconds", "Stop and close"]) {
        const box = await player.getByRole("button", { name, exact: true }).boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(layout.width + 1);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(layout.height + 1);
      }
      const transport = await player.getByRole("group", { name: "Playback controls" }).boundingBox();
      expect(transport!.x + transport!.width).toBeLessThanOrEqual(layout.width + 1);

      const reserved = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(".adaptive-shell-root");
        return shell?.style.getPropertyValue("--shell-audio-player-height") ?? "";
      });
      const reservedPx = Number.parseFloat(reserved);
      expect(reservedPx).toBeGreaterThan(0);
      expect(Math.abs(reservedPx - dock!.height)).toBeLessThanOrEqual(2);
      await page.getByRole("button", { name: /^Expand audio player:/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialog = await page.getByRole("dialog").boundingBox();
      expect(dialog!.y).toBeGreaterThanOrEqual(0);
      expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(layout.height + 1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  }
}

for (const width of [768, 1024]) {
  test(`tablet-width desktop dock stays contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/audio-player-harness.html");
    await page.getByRole("button", { name: "Play fixture", exact: true }).click();
    const player = page.getByRole("region", { name: "Audio player" });
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    for (const name of ["Back 30 seconds", "Pause", "Forward 30 seconds", "Stop and close"]) {
      const box = await player.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    const reserved = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".adaptive-shell-root");
      return shell?.style.getPropertyValue("--shell-audio-player-height") ?? "";
    });
    expect(Number.parseFloat(reserved)).toBeGreaterThan(0);
  });
}

for (const width of [320, 360, 390, 412]) {  test(`mobile dock sits above navigation with reachable transport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/audio-player-harness.html?mobile");
    await page.getByRole("button", { name: "Play fixture", exact: true }).click();
    const player = page.getByRole("region", { name: "Audio player" });
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

    const dock = await player.boundingBox();
    const navigation = await page.getByText("Mobile navigation", { exact: true }).boundingBox();
    expect(dock!.x).toBeGreaterThanOrEqual(0);
    expect(dock!.x + dock!.width).toBeLessThanOrEqual(width + 1);
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(navigation!.y + 1);
    for (const name of ["Back 30 seconds", "Pause", "Forward 30 seconds"]) {
      const box = await player.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await player.getByRole("button", { name: /^Expand audio player:/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

    // Rotation keeps the dock above navigation with no re-seek or reload.
    await page.setViewportSize({ width: 740, height: 320 });
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const rotated = await player.boundingBox();
    const rotatedNav = await page.getByText("Mobile navigation", { exact: true }).boundingBox();
    expect(rotated!.x + rotated!.width).toBeLessThanOrEqual(741);
    expect(rotated!.y + rotated!.height).toBeLessThanOrEqual(rotatedNav!.y + 1);
    const state = await page.evaluate(async () => {
      const url = "/src/services/audio/audioRuntime.ts";
      return (await import(/* @vite-ignore */ url)).getGlobalAudioController().getSnapshot();
    });
    expect(state.generation).toBe(1);
    expect(state.playIntent).toBe(true);
  });
}

test("mini-player text and primary transport meet AA contrast in light and dark themes", async ({ page }) => {
  const measure = async (scheme: "light" | "dark") => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/audio-player-harness.html");
    await page.getByRole("button", { name: "Play fixture", exact: true }).click();
    const player = page.getByRole("region", { name: "Audio player" });
    await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    return page.evaluate(() => {
      const luminance = (value: string) => {
        const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        const [r, g, b] = channels.map(channel => {
          const srgb = channel / 255;
          return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (foreground: string, background: string) => {
        const a = luminance(foreground);
        const b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const dock = document.querySelector<HTMLElement>(".audio-dock-slot")!;
      const title = document.querySelector<HTMLElement>(".audio-player-title .font-medium")!;
      const play = document.querySelector<HTMLElement>(".audio-mini-player button.bg-primary")!;
      const style = (element: HTMLElement) => window.getComputedStyle(element);
      let surface = style(dock).backgroundColor;
      if (surface === "rgba(0, 0, 0, 0)" || surface === "transparent") surface = style(document.body).backgroundColor;
      return {
        title: ratio(style(title).color, surface),
        transport: ratio(style(play).color, style(play).backgroundColor),
      };
    });
  };
  const light = await measure("light");
  expect(light.title).toBeGreaterThanOrEqual(4.5);
  expect(light.transport).toBeGreaterThanOrEqual(4.5);
  const dark = await measure("dark");
  expect(dark.title).toBeGreaterThanOrEqual(4.5);
  expect(dark.transport).toBeGreaterThanOrEqual(4.5);
});

test("expanded player module loads lazily and reduced motion disables dock animation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("ExpandedAudioPlayer")) requests.push(request.url());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/audio-player-harness.html");
  await page.getByRole("button", { name: "Play fixture", exact: true }).click();
  const player = page.getByRole("region", { name: "Audio player" });
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await player.getByRole("button", { name: /^Expand audio player:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const durations = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".audio-mini-player *"))
      .map(element => window.getComputedStyle(element))
      .map(style => [style.animationDuration, style.transitionDuration])
      .flat()
      .filter(value => value !== "0s"),
  );
  expect(durations).toEqual([]);
});

test("queue controls remain distinct from transport and preserve paused intent without a source view", async ({ page }) => {
  page.on("pageerror", error => console.error("audio queue fixture:", error.stack));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/audio-player-harness.html?mobile&queue");
  await page.getByRole("button", { name: "Play fixture", exact: true }).click();
  const player = page.getByRole("region", { name: "Audio player" });
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Close source tab" }).click();
  await player.getByRole("button", { name: /^Expand audio player:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
  const queue = page.getByRole("group", { name: "Queue", exact: true });
  await expect(queue.getByRole("button", { name: "Previous queue item" })).toBeDisabled();
  await queue.getByRole("button", { name: "Next queue item" }).click();
  await expect(page.getByRole("dialog").getByText("Next audiobook", { exact: true })).toBeVisible();
  await expect(queue.getByText("Item 2 of 2", { exact: true })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Next queue item" })).toBeDisabled();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const state = await page.evaluate(async () => {
    const url = "/src/services/audio/audioRuntime.ts";
    return (await import(/* @vite-ignore */ url)).getGlobalAudioController().getSnapshot();
  });
  expect(state.generation).toBe(2);
  expect(state.playIntent).toBe(false);
  expect(state.queue.map((key: { sourceId: string }) => key.sourceId)).toEqual(["audio-owner-fixture", "audio-queue-fixture"]);
});
