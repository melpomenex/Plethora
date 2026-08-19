/**
 * Queue View control removal (#12).
 *
 * The "High-Retention Maintenance" / "New Material Exploration" block cards
 * and their budget inputs must be gone, along with the dead block code in
 * reviewUx, while unrelated scheduling/retention functionality (presets,
 * postpone, workload/forecast, easy days) must remain.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

describe("Queue View control removal (#12)", () => {
  it("the block cards are absent from ReviewQueueView", () => {
    const source = read("src/components/review/ReviewQueueView.tsx");
    expect(source).not.toContain("sessionBlocks");
    expect(source).not.toContain("safeStopAfterItem");
    expect(source).not.toContain("High-Retention Maintenance");
    expect(source).not.toContain("New Material Exploration");
    expect(source).not.toContain("buildSessionBlocks");
  });

  it("the budget inputs are absent from SessionCustomizeModal", () => {
    const source = read("src/components/review/SessionCustomizeModal.tsx");
    expect(source).not.toContain("blockTimeBudgets");
    expect(source).not.toContain("maintenanceBlock");
    expect(source).not.toContain("explorationBlock");
    expect(source).not.toContain("overdueRescue");
    expect(source).not.toContain("focusBlock");
  });

  it("the dead block code is removed from reviewUx", () => {
    const source = read("src/utils/reviewUx.ts");
    expect(source).not.toContain("buildSessionBlocks");
    expect(source).not.toContain("SessionBlock");
    expect(source).not.toContain("SessionBlockTimeBudgets");
    expect(source).not.toContain("computeSafeStop");
    expect(source).not.toContain("blockTimeBudgets");
    expect(source).not.toContain("applyMaxItems");
  });

  it("no locale still carries the removed sessionCustomize.*Block or queue block keys", () => {
    for (const loc of ["en", "de", "es", "fr", "ja", "zh"]) {
      const source = read(`src/lib/i18n/locales/${loc}.ts`);
      expect(source, `${loc} still has block budget keys`).not.toMatch(
        /"sessionCustomize\.(blockTimeBudgets|overdueRescue|maintenanceBlock|explorationBlock|focusBlock)"/
      );
      expect(source, `${loc} still has block-card keys`).not.toMatch(
        /"queue\.(safeStopAfterItem|moreCount)"/
      );
    }
  });
});

describe("unrelated scheduling/retention preserved (#12)", () => {
  it("queue strategy presets remain selectable in ReviewQueueView", () => {
    const source = read("src/components/review/ReviewQueueView.tsx");
    expect(source).toContain("queueStrategyPreset");
    expect(source).toContain("handleSetPreset");
  });

  it("postpone, workload/forecast and easy-days surface remains in the queue/backend", () => {
    const queueView = read("src/components/review/ReviewQueueView.tsx");
    expect(queueView).toContain("postponeItem");
    expect(read("src/routes/queue.tsx")).toContain("PostponeAllDialog");
    const backend = read("src-tauri/src/lib.rs");
    expect(backend).toContain("get_due_workload_forecast");
    expect(backend).toContain("apply_easy_days");
    expect(backend).toContain("load_balance_queue");
  });

  it("the review-session retention label remains", () => {
    const en = read("src/lib/i18n/locales/en.ts");
    expect(en).toContain('"review.retentionMaintenance"');
  });

  it("optimal-session review queue still honors the maxItems cap", () => {
    // With the session blocks gone, handleStartOptimalSession derives the
    // review queue from visibleItems; the maxItems cap from the session
    // customization must be preserved (previously applied by applyMaxItems).
    const source = read("src/components/review/ReviewQueueView.tsx");
    expect(source).toContain(".slice(0, sessionCustomization.maxItems)");
  });
});
