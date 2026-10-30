import type { LearningItem } from "./learning-items";

/** Normalize top-level IPC field names; nested interaction metadata is authored data. */
export function normalizeLearningItem(value: unknown): LearningItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    fields[normalized] = field;
  }
  const typeNames: Record<string, LearningItem["item_type"]> = {
    flashcard: "Flashcard",
    basic: "Basic",
    qa: "Qa",
    cloze: "Cloze",
    imageocclusion: "ImageOcclusion",
    "image-occlusion": "ImageOcclusion",
  };
  const stateNames: Record<string, LearningItem["state"]> = { new: "New", learning: "Learning", review: "Review", relearning: "Relearning" };
  const itemType = typeof fields.item_type === "string" ? (typeNames[fields.item_type.toLowerCase()] ?? (fields.item_type as LearningItem["item_type"])) : undefined;
  const state = typeof fields.state === "string" ? stateNames[fields.state.toLowerCase()] : undefined;
  if (fields._deleted === true || typeof fields.id !== "string" || !fields.id || typeof fields.question !== "string" || !itemType || !state ||
      typeof fields.is_suspended !== "boolean" || !Array.isArray(fields.tags) ||
      ![fields.due_date, fields.date_created, fields.date_modified].every((field) => typeof field === "string") ||
      ![fields.difficulty, fields.interval, fields.ease_factor, fields.review_count, fields.lapses].every((field) => typeof field === "number" && Number.isFinite(field))) return null;
  return { ...fields, item_type: itemType, state } as unknown as LearningItem;
}
