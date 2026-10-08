import { formatSelectionExcerpt } from "./assistantContext";

export interface SelectionAskSnapshot {
  excerpt: string;
  truncated: boolean;
  documentId?: string;
  documentTitle?: string;
  locator?: string;
  createdAt: number;
}

export const SELECTION_ASK_EVENT = "plethora:selection-ask";

export interface SelectionAskEventDetail {
  snapshot: SelectionAskSnapshot;
  question?: string;
}

export function createSelectionAskSnapshot(
  text: string,
  options: { documentId?: string; documentTitle?: string; locator?: string } = {},
): SelectionAskSnapshot | null {
  const { text: excerpt, truncated } = formatSelectionExcerpt(text);
  if (!excerpt) return null;
  return {
    excerpt,
    truncated,
    documentId: options.documentId,
    documentTitle: options.documentTitle,
    locator: options.locator,
    createdAt: Date.now(),
  };
}

export function shouldReseedSelectionSnapshot(
  prev: SelectionAskSnapshot | null,
  next: SelectionAskSnapshot | null,
): boolean {
  if (!next) return false;
  if (!prev) return true;
  if (prev.documentId !== next.documentId) return true;
  return prev.excerpt !== next.excerpt;
}

export function buildSelectionAskSeedMessage(snapshot: SelectionAskSnapshot, question: string): string {
  const source = snapshot.documentTitle
    ? ` (from ${snapshot.documentTitle}${snapshot.locator ? ` • ${snapshot.locator}` : ""})`
    : snapshot.locator
      ? ` (${snapshot.locator})`
      : "";
  const quoted = snapshot.excerpt.length > 2000
    ? `${snapshot.excerpt.slice(0, 2000)}…`
    : snapshot.excerpt;
  return `> ${quoted}${source}\n\n${question.trim()}`;
}

export function describeSelectionAskSnapshot(snapshot: SelectionAskSnapshot): string {
  const source = snapshot.documentTitle ?? snapshot.locator ?? "selection";
  const preview = snapshot.excerpt.replace(/\s+/g, " ").trim().slice(0, 100);
  return `${source}: "${preview}${snapshot.excerpt.length > 100 ? "…" : ""}"`;
}

/**
 * Single entry point for every select → Ask surface (bar / menu / sheet).
 * Snapshots the selection with its document reference and notifies the
 * Assistant host to open/focus, seed the thread, and focus follow-up input.
 * Returns the snapshot so direct callers (tests, non-DOM hosts) can seed
 * without relying on the event.
 */
export function requestSelectionAsk(
  text: string,
  options: { documentId?: string; documentTitle?: string; locator?: string; question?: string } = {},
): SelectionAskSnapshot | null {
  const snapshot = createSelectionAskSnapshot(text, options);
  if (!snapshot) return null;
  try {
    const detail: SelectionAskEventDetail = { snapshot, question: options.question };
    window.dispatchEvent(new CustomEvent<SelectionAskEventDetail>(SELECTION_ASK_EVENT, { detail }));
  } catch {
    // Non-DOM hosts (tests, workers) still get the snapshot return value.
  }
  return snapshot;
}
