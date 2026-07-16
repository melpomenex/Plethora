import { describe, expect, it } from "vitest";
import type { ScheduleDayItem } from "../../../types/queue";
import {
  getScheduleItemTitle,
  previewSchedulePrompt,
  SCHEDULE_TITLE_PREVIEW_LENGTH,
} from "../scheduleTitles";

const translate = (key: string, vars?: Record<string, string | number>) => {
  if (key === "schedule.flashcardTitle") return `Flashcard: ${vars?.prompt ?? ""}`;
  if (key === "schedule.learningItemFallback") return "Flashcard";
  if (key === "schedule.documentFallback") return "Untitled document";
  return key;
};

const baseItem = (overrides: Partial<ScheduleDayItem> = {}): ScheduleDayItem => ({
  id: "learning-1",
  documentId: "document-1",
  documentTitle: "A Source Document",
  itemType: "learning-item",
  dueDate: "2026-07-16T00:00:00.000Z",
  estimatedTime: 1,
  priority: 1,
  tags: [],
  progress: 0,
  ...overrides,
});

describe("schedule item titles", () => {
  it("prefers a real parent document title", () => {
    expect(getScheduleItemTitle(baseItem(), translate)).toBe("A Source Document");
  });

  it("uses the question when the parent title is generic", () => {
    const item = baseItem({
      documentTitle: "Untitled Document",
      question: "  What caused the Roman Empire to split?  ",
    });

    expect(getScheduleItemTitle(item, translate)).toBe(
      "Flashcard: What caused the Roman Empire to split?",
    );
  });

  it("falls back to cloze text and then to a generic flashcard label", () => {
    expect(getScheduleItemTitle(baseItem({ documentTitle: "Unknown Document", clozeText: "{{memory}}" }), translate))
      .toBe("Flashcard: {{memory}}");
    expect(getScheduleItemTitle(baseItem({ documentTitle: "", question: "", clozeText: "" }), translate))
      .toBe("Flashcard");
  });

  it("collapses whitespace and bounds prompt previews", () => {
    const prompt = "word ".repeat(30);
    const preview = previewSchedulePrompt(prompt);

    expect(preview.length).toBe(SCHEDULE_TITLE_PREVIEW_LENGTH);
    expect(preview).toMatch(/…$/);
    expect(preview).not.toMatch(/\s{2,}/);
  });

  it("does not mutate identifiers while resolving a title", () => {
    const item = baseItem({ documentTitle: "—", question: "Which item?" });
    const title = getScheduleItemTitle(item, translate);

    expect(title).toBe("Flashcard: Which item?");
    expect(item).toMatchObject({
      id: "learning-1",
      documentId: "document-1",
      itemType: "learning-item",
    });
  });
});
