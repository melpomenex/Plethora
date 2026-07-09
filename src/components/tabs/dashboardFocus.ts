export type DailyFocusKind = "review" | "continue-reading" | "queue" | "documents";

export interface DailyFocusInput {
  cardsDue: number;
  dueDocuments: number;
  hasResumableReading: boolean;
  documentCount: number;
}

export function selectDailyFocus({ cardsDue, dueDocuments, hasResumableReading, documentCount }: DailyFocusInput): DailyFocusKind {
  if (cardsDue > 0) return "review";
  if (hasResumableReading) return "continue-reading";
  if (dueDocuments > 0) return "queue";
  return documentCount > 0 ? "documents" : "documents";
}
