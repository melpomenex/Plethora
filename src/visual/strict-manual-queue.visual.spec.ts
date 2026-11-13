import { expect, test } from "@playwright/test";

const fixture = "/strict-manual-queue-fixture";
const modules = {
  db: "/src/lib/database.ts",
  browser: "/src/lib/browser-backend.ts",
  settings: "/src/stores/settingsStore.ts",
  queue: "/src/api/queue.ts",
  postpone: "/src/api/autoPostpone.ts",
};

test("strict manual queue and stale-plan guards survive an IndexedDB reopen", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-01-01T00:00:00.000Z"));
  await page.route(`**${fixture}`, (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>Strict Manual fixture</title>",
  }));
  await page.goto(fixture);

  const videoId = await page.evaluate(async ({ db, browser, settings }) => {
    const { createDocument, createExtract, createLearningItem, setQueuePrioritiesAtomic, updateDocument } = await import(db);
    const { browserInvoke } = await import(browser);
    const { useSettingsStore } = await import(settings);
    const old = "2026-01-01T00:00:00.000Z";
    const future = "2090-01-01T00:00:00.000Z";
    await createDocument({ id: "d100", title: "New high priority" });
    await createDocument({ id: "d75", title: "Source video", file_type: "video", next_reading_date: old });
    await createDocument({ id: "future", title: "Future", next_reading_date: future });
    await createDocument({ id: "excluded", title: "Archived", is_archived: true, next_reading_date: old });
    await createDocument({ id: "outside", title: "Other collection", next_reading_date: old });
    await updateDocument("outside", { collection_id: "other" });
    await createExtract({ id: "e50", document_id: "d75", content: "Extract", next_review_date: old });
    await createLearningItem({ id: "c25", document_id: "d75", question: "Question", answer: "Answer", due_date: old });
    const video = await browserInvoke("create_video_extract", {
      documentId: "d75", startTime: 0, endTime: 2, title: "Segment", addToQueue: true,
      initialReviewDate: "2026-01-02",
    });
    const targets = [
      { kind: "document", id: "d100", value: 100 },
      { kind: "document", id: "d75", value: 75 },
      { kind: "extract", id: "e50", value: 50 },
      { kind: "learning-item", id: "c25", value: 25 },
      { kind: "video-extract", id: video.id, value: 0 },
      { kind: "document", id: "future", value: 99 },
      { kind: "document", id: "outside", value: 100 },
    ];
    for (const { kind, id, value } of targets) {
      const result = await setQueuePrioritiesAtomic([{ kind, id }], value);
      if (result.failed.length) throw new Error(result.errors.join(", "));
    }
    const rejected = await setQueuePrioritiesAtomic([{ kind: "learning-item", id: "missing" }], 100);
    if (rejected.failed[0] !== "learning-item:missing") throw new Error("Missing priority target was accepted");
    useSettingsStore.getState().updateSettingsCategory("smartQueue", { queueOrderingMode: "strict_manual" });
    return video.id as string;
  }, modules);

  await page.clock.setFixedTime(new Date("2026-11-13T12:00:00.000Z"));
  await page.reload();
  const observed = await page.evaluate(async ({ queue, db, settings, postpone, browser }) => {
    const { getQueue, getDueQueueItems, getQueueItems, getNextQueueItem } = await import(queue);
    const { useSettingsStore } = await import(settings);
    const { setQueuePrioritiesAtomic, getDocument, closeDatabase } = await import(db);
    const { getAutoPostponeCandidates, applyAutoPostponePlan } = await import(postpone);
    const { browserInvoke } = await import(browser);
    await useSettingsStore.persist.rehydrate();
    const mode = useSettingsStore.getState().settings.smartQueue.queueOrderingMode;
    const all = await getQueue("default");
    const due = await getDueQueueItems(1, "default");
    const firstTwo = await getQueueItems(2, 1, "default");
    const next = await getNextQueueItem(1, "default");
    const windowStart = "2026-11-12T00:00:00.000Z";
    const windowEnd = "2026-12-12T00:00:00.000Z";
    const preview = await getAutoPostponeCandidates("default", windowStart, windowEnd, true);
    const protectedVideo = preview.candidates.find(({ entityType }: { entityType: string }) => entityType === "video-extract");
    const priorDue = (await getDocument("d75")).next_reading_date;
    const plan = [{
      id: "d75", entityType: "document", expectedDueDate: priorDue, targetDueDate: "2026-11-13",
    }];
    // Change a different row. The entire preview must be invalidated.
    await setQueuePrioritiesAtomic([{ kind: "learning-item", id: "c25" }], 30);
    const stale = await applyAutoPostponePlan("default", plan, { windowStart, windowEnd, revision: preview.revision });
    const afterPriority = await getAutoPostponeCandidates("default", windowStart, windowEnd, true);
    await browserInvoke("postpone_video_extract", { extractId: protectedVideo.id, days: 1 });
    const staleVideo = await applyAutoPostponePlan("default", plan, { windowStart, windowEnd, revision: afterPriority.revision });
    const refreshed = await getAutoPostponeCandidates("default", windowStart, windowEnd, true);
    const cardPlan = [{
      id: "c25", entityType: "learning-item", expectedDueDate: due.find(({ id }: { id: string }) => id === "c25").dueDate,
      targetDueDate: "2026-11-13",
    }];
    const check = { windowStart, windowEnd, revision: refreshed.revision };
    const applied = await applyAutoPostponePlan("default", cardPlan, check);
    const retry = await applyAutoPostponePlan("default", cardPlan, check);
    closeDatabase();
    const cardDue = (await getDueQueueItems(undefined, "default")).find(({ id }: { id: string }) => id === "c25")?.dueDate;
    return {
      mode,
      all: all.map(({ id }: { id: string }) => id),
      due: due.map(({ id, priorityDisplaySlider }: { id: string; priorityDisplaySlider: number }) => [id, priorityDisplaySlider]),
      firstTwo: firstTwo.map(({ id }: { id: string }) => id),
      next: next.id,
      stale: stale.outcomes[0].status,
      staleVideo: staleVideo.outcomes[0].status,
      applied: applied.outcomes[0].status,
      retry: retry.outcomes[0].status,
      cardDue,
      dueAfter: (await getDocument("d75")).next_reading_date,
      priorDue,
    };
  }, modules);

  expect(observed.mode).toBe("strict_manual");
  expect(observed.all).toEqual(["d100", "future", "d75", "e50", "c25", videoId]);
  expect(observed.due).toEqual([["d100", 100], ["d75", 75], ["e50", 50], ["c25", 25], [videoId, 0]]);
  expect(observed.firstTwo).toEqual(["d100", "future"]);
  expect(observed.next).toBe("d100");
  expect(observed.stale).toBe("skipped");
  expect(observed.staleVideo).toBe("skipped");
  expect(observed.applied).toBe("postponed");
  expect(observed.retry).toBe("skipped");
  expect(observed.cardDue).toBe("2026-11-13T00:00:00.000Z");
  expect(observed.dueAfter).toBe(observed.priorDue);
});
