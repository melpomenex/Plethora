import type { VideoExtract, VideoExtractQueueStatus } from "../api/video-extracts";

export interface CreationQueueIntent {
  addToQueue: boolean;
  initialReviewDate?: string | Date | null;
  now?: Date;
}

export interface ResolvedCreationQueueIntent {
  queue_status: VideoExtractQueueStatus;
  next_review_date?: string;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Enter a valid review date");
  return date;
}

/**
 * Mirror of the Rust creation rule. Today (UTC calendar day) means eligible
 * immediately; a future day stores the start of that UTC day.
 */
export function resolveVideoExtractQueueIntent({
  addToQueue,
  initialReviewDate,
  now = new Date(),
}: CreationQueueIntent): ResolvedCreationQueueIntent {
  if (!addToQueue) {
    if (initialReviewDate) throw new Error("An initial review date requires Add to Queue");
    return { queue_status: "not_queued" };
  }
  if (!initialReviewDate) {
    return { queue_status: "queued" };
  }
  const requested = parseDate(initialReviewDate);
  const requestedDay = utcDay(requested);
  const today = utcDay(now);
  if (requestedDay < today) throw new Error("The initial review date cannot be in the past");
  if (requestedDay === today) return { queue_status: "queued" };
  return { queue_status: "queued", next_review_date: `${requestedDay}T00:00:00.000Z` };
}

export type VideoExtractLifecycleKind = "new" | "seen_unreviewed" | "reviewed";
export type VideoExtractQueueKind =
  | "not_queued"
  | "queued_new"
  | "queued_due"
  | "queued_scheduled"
  | "needs_schedule";

export function videoExtractLifecycleKind(extract: VideoExtract): VideoExtractLifecycleKind {
  if (extract.last_reviewed_at || extract.review_count > 0) return "reviewed";
  if (extract.last_viewed_at || extract.first_seen_at) return "seen_unreviewed";
  return "new";
}

export function videoExtractQueueKind(
  extract: VideoExtract,
  cutoff: Date = new Date(),
): VideoExtractQueueKind {
  if (extract.queue_status !== "queued") return "not_queued";
  if (!extract.next_review_date) {
    return extract.review_count === 0 ? "queued_new" : "needs_schedule";
  }
  const due = new Date(extract.next_review_date);
  if (Number.isNaN(due.getTime())) return "needs_schedule";
  return due.getTime() <= cutoff.getTime() ? "queued_due" : "queued_scheduled";
}

/**
 * Display-only mirror of the server eligibility predicate. Server rows remain
 * authoritative; this is used to label and gate UI controls.
 */
export function isVideoExtractQueueEligible(
  extract: VideoExtract,
  cutoff: Date = new Date(),
): boolean {
  const kind = videoExtractQueueKind(extract, cutoff);
  return kind === "queued_new" || kind === "queued_due";
}

export function isVideoExtractFutureScheduled(
  extract: VideoExtract,
  cutoff: Date = new Date(),
): boolean {
  return videoExtractQueueKind(extract, cutoff) === "queued_scheduled";
}
