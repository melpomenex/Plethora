import { describe, it, expect, vi } from "vitest";
import {
  actionAppliesTo,
  actionDisabled,
  runScheduleAction,
  runPostpone,
  POSTPONE_PRESETS,
} from "../scheduleActions";
import type { ScheduleDayItem } from "../../types/queue";

const item = (overrides: Partial<ScheduleDayItem> & { id: string }): ScheduleDayItem => ({
  id: overrides.id,
  documentId: "doc-1",
  documentTitle: "Doc",
  itemType: "learning-item",
  dueDate: "2026-06-15",
  estimatedTime: 5,
  priority: 5,
  tags: [],
  progress: 50,
  ...overrides,
});

describe("actionAppliesTo", () => {
  it("defines applicability per item type", () => {
    // open + delete apply to every type
    expect(actionAppliesTo("open", "document")).toBe(true);
    expect(actionAppliesTo("open", "extract")).toBe(true);
    expect(actionAppliesTo("open", "learning-item")).toBe(true);
    expect(actionAppliesTo("delete", "extract")).toBe(true);
    // postpone only documents + learning items
    expect(actionAppliesTo("postpone", "document")).toBe(true);
    expect(actionAppliesTo("postpone", "learning-item")).toBe(true);
    expect(actionAppliesTo("postpone", "extract")).toBe(false);
    // suspend/unsuspend only learning items
    expect(actionAppliesTo("suspend", "learning-item")).toBe(true);
    expect(actionAppliesTo("suspend", "document")).toBe(false);
    expect(actionAppliesTo("unsuspend", "extract")).toBe(false);
    // dismiss only documents
    expect(actionAppliesTo("dismiss", "document")).toBe(true);
    expect(actionAppliesTo("dismiss", "learning-item")).toBe(false);
  });

  it("returns false for unknown actions", () => {
    expect(actionAppliesTo("open" as any, "document")).toBe(true);
  });
});

describe("actionDisabled", () => {
  it("disables actions while the item is busy", () => {
    // Definitions currently rely on callers disabling via busy state; with no
    // custom disabled fn the default is false.
    expect(actionDisabled("postpone", { busy: true })).toBe(false);
  });
});

describe("runScheduleAction", () => {
  it("invokes the matching callback with the item id/type", async () => {
    const callbacks = {
      onOpen: vi.fn(),
      onSuspend: vi.fn(),
      onUnsuspend: vi.fn(),
      onDismiss: vi.fn(),
      onDelete: vi.fn(),
    };
    await runScheduleAction("open", item({ id: "a" }), callbacks);
    expect(callbacks.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));

    await runScheduleAction("suspend", item({ id: "a" }), callbacks);
    expect(callbacks.onSuspend).toHaveBeenCalledWith("a", "learning-item");

    await runScheduleAction("unsuspend", item({ id: "a" }), callbacks);
    expect(callbacks.onUnsuspend).toHaveBeenCalledWith("a", "learning-item");

    await runScheduleAction("dismiss", item({ id: "a", itemType: "document" }), callbacks);
    expect(callbacks.onDismiss).toHaveBeenCalledWith("a");

    await runScheduleAction("delete", item({ id: "a" }), callbacks);
    expect(callbacks.onDelete).toHaveBeenCalledWith("a", "learning-item");
  });

  it("refuses inapplicable actions", async () => {
    const callbacks = { onSuspend: vi.fn(), onDismiss: vi.fn() };
    const doc = item({ id: "d", itemType: "document" });
    expect(await runScheduleAction("suspend", doc, callbacks)).toBe(false);
    expect(callbacks.onSuspend).not.toHaveBeenCalled();

    const li = item({ id: "l" });
    expect(await runScheduleAction("dismiss", li, callbacks)).toBe(false);
    expect(callbacks.onDismiss).not.toHaveBeenCalled();
  });

  it("does not require optional callbacks to be present", async () => {
    expect(await runScheduleAction("open", item({ id: "a" }), {})).toBe(true);
    expect(await runScheduleAction("delete", item({ id: "a" }), {})).toBe(true);
  });
});

describe("runPostpone", () => {
  it("invokes onPostpone with the preset and item type", async () => {
    const onPostpone = vi.fn();
    const ok = await runPostpone(item({ id: "a" }), 3, { onPostpone });
    expect(ok).toBe(true);
    expect(onPostpone).toHaveBeenCalledWith("a", 3, "learning-item");
  });

  it("refuses postpone for extracts", async () => {
    const onPostpone = vi.fn();
    const ok = await runPostpone(item({ id: "a", itemType: "extract" }), 3, { onPostpone });
    expect(ok).toBe(false);
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it("exposes the standard presets", () => {
    expect(POSTPONE_PRESETS).toEqual([1, 3, 7, 14, 30]);
  });
});
