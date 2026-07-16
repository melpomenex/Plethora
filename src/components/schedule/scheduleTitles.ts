import type { ScheduleDayItem } from "../../types/queue";

type ScheduleTranslator = (key: string, vars?: Record<string, string | number>) => string;

const GENERIC_DOCUMENT_TITLES = new Set([
  "—",
  "-",
  "unknown",
  "unknown document",
  "untitled",
  "untitled document",
]);

export const SCHEDULE_TITLE_PREVIEW_LENGTH = 80;

function isUsableTitle(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return normalized.length > 0 && !GENERIC_DOCUMENT_TITLES.has(normalized.toLowerCase());
}

export function previewSchedulePrompt(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, " ");
  if (compact.length <= SCHEDULE_TITLE_PREVIEW_LENGTH) return compact;
  return `${compact.slice(0, SCHEDULE_TITLE_PREVIEW_LENGTH - 1)}…`;
}

/**
 * Resolve a schedule item's visible title without changing the item's IDs or
 * action semantics. Learning items use their prompt only when the source
 * document title is unavailable, so the schedule remains source-oriented.
 */
export function getScheduleItemTitle(
  item: ScheduleDayItem,
  t: ScheduleTranslator,
): string {
  if (isUsableTitle(item.documentTitle)) return item.documentTitle.trim();

  if (item.itemType === "learning-item") {
    const prompt = [item.question, item.clozeText]
      .find((value): value is string => Boolean(value?.trim()));
    if (prompt) {
      return t("schedule.flashcardTitle", { prompt: previewSchedulePrompt(prompt) });
    }
    return t("schedule.learningItemFallback");
  }

  return item.documentTitle.trim() || t("schedule.documentFallback");
}
