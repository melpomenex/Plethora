/**
 * ScrollFeedScope — the discriminated input that determines WHICH feeds a
 * Scroll Mode session loads.
 *
 * One optional scope object (rather than several booleans) prevents impossible
 * states like having both a folderId and a category set. RSSScrollMode resolves
 * the scope to a concrete Feed[] once, then runs the existing interleave +
 * engagement-sort pipeline unchanged. `label` is shown in the Scroll Mode
 * header so the user always knows what scope is active.
 *
 * `all` is the default (current behavior): every subscribed feed.
 */
export type ScrollFeedScope =
  | { kind: "all" }
  | { kind: "folder"; folderId: string; label: string }
  | { kind: "category"; category: string; label: string }
  | { kind: "feeds"; feedIds: string[]; label: string }
  | { kind: "readingList"; readingListId: string; label: string };

export const ALL_FEEDS_SCOPE: ScrollFeedScope = { kind: "all" };

/**
 * Helper for building an ad-hoc "feeds" scope with a count-based label.
 */
export function feedsScope(feedIds: string[], labelFn: (n: number) => string): ScrollFeedScope {
  const unique = Array.from(new Set(feedIds));
  return { kind: "feeds", feedIds: unique, label: labelFn(unique.length) };
}
