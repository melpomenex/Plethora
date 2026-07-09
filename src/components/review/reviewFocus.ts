export type ReviewHomeAction = "start-review" | "continue-reading";

export function getReviewHomeAction(dueItemCount: number): ReviewHomeAction {
  return dueItemCount > 0 ? "start-review" : "continue-reading";
}
