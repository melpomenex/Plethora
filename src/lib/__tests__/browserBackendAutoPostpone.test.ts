import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database", () => ({
  getDocuments: vi.fn(),
  getAllExtracts: vi.fn(),
  getAllLearningItems: vi.fn(),
  applyBrowserAutoPostponePlan: vi.fn(),
}));
vi.mock("../../stores/llmProvidersStore", () => ({
  useLLMProvidersStore: { getState: () => ({ providers: [] }) },
}));

import { browserInvoke } from "../browser-backend";
import * as db from "../database";
import { DEFAULT_COLLECTION_ID } from "../../types/collection";

describe("browser auto-postpone commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads compact active-collection candidates and existing schedule dates", async () => {
    const today = new Date();
    const date = (offset: number) => {
      const value = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    };
    vi.mocked(db.getDocuments).mockResolvedValue([
      { id: "doc-overdue", collection_id: DEFAULT_COLLECTION_ID, next_reading_date: date(-4), is_archived: false, is_dismissed: false } as any,
      { id: "doc-other", collection_id: "other", next_reading_date: date(-4), is_archived: false, is_dismissed: false } as any,
      { id: "doc-future", collection_id: DEFAULT_COLLECTION_ID, next_reading_date: date(3), is_archived: false, is_dismissed: false } as any,
      { id: "doc-archived", collection_id: DEFAULT_COLLECTION_ID, next_reading_date: date(6), is_archived: true, is_dismissed: false } as any,
    ]);
    vi.mocked(db.getAllLearningItems).mockResolvedValue([
      { id: "card-overdue", collection_id: DEFAULT_COLLECTION_ID, due_date: date(-3), interval: 8, review_count: 2, is_suspended: false } as any,
      { id: "card-suspended", collection_id: DEFAULT_COLLECTION_ID, due_date: date(-3), interval: 8, review_count: 2, is_suspended: true } as any,
      { id: "card-archived-parent", collection_id: DEFAULT_COLLECTION_ID, document_id: "doc-archived", due_date: date(6), interval: 8, review_count: 2, is_suspended: false } as any,
    ]);
    vi.mocked(db.getAllExtracts).mockResolvedValue([
      { id: "extract-overdue", collection_id: DEFAULT_COLLECTION_ID, document_id: "doc-overdue", next_review_date: date(-2), review_count: 1 } as any,
    ]);

    const result = await browserInvoke<{
      candidates: Array<{ id: string; entityType: string; isSuspended: boolean }>;
      scheduledDates: string[];
    }>("get_auto_postpone_candidates", {
      collectionId: DEFAULT_COLLECTION_ID,
      windowStart: date(0),
      windowEnd: date(32),
    });

    expect(result.candidates.map((item) => [item.id, item.entityType])).toEqual([
      ["card-overdue", "learning-item"],
      ["card-suspended", "learning-item"],
      ["card-archived-parent", "learning-item"],
      ["doc-overdue", "document"],
      ["doc-future", "document"],
      ["doc-archived", "document"],
      ["extract-overdue", "extract"],
    ]);
    expect(result.candidates.find((item) => item.id === "card-suspended")?.isSuspended).toBe(true);
    expect(result.scheduledDates).toContain(date(3));
    expect(result.scheduledDates).not.toContain(date(6));
    expect(result.candidates.map((item) => item.id)).not.toContain("doc-other");
  });

  it("delegates plan application with the active collection for transaction scoping", async () => {
    const outcomes = [{ id: "doc-1", status: "postponed" as const }];
    vi.mocked(db.applyBrowserAutoPostponePlan).mockResolvedValue(outcomes);
    const plan = [{
      id: "doc-1", entityType: "document", expectedDueDate: "2026-10-01",
      targetDueDate: "2026-10-15T00:00:00.000Z",
    }];

    await expect(browserInvoke("apply_auto_postpone_plan", {
      collectionId: "collection-2",
      plan,
    })).resolves.toEqual({ outcomes });

    expect(db.applyBrowserAutoPostponePlan).toHaveBeenCalledWith(plan, "collection-2");
  });
});
