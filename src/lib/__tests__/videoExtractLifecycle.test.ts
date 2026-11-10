import { describe, expect, it } from "vitest";
import type { VideoExtract } from "../../api/video-extracts";
import {
  isVideoExtractQueueEligible,
  resolveVideoExtractQueueIntent,
  videoExtractLifecycleKind,
  videoExtractQueueKind,
} from "../videoExtractLifecycle";

const NOW = new Date("2026-10-29T12:00:00.000Z");

function extract(overrides: Partial<VideoExtract> = {}): VideoExtract {
  return {
    id: "extract",
    document_id: "video",
    queue_status: "queued",
    start_time: 10,
    end_time: 30,
    title: "Segment",
    tags: [],
    review_count: 0,
    reps: 0,
    date_created: "2026-10-29T12:00:00.000Z",
    date_modified: "2026-10-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("resolveVideoExtractQueueIntent", () => {
  it("matches the Rust creation matrix", () => {
    expect(resolveVideoExtractQueueIntent({ addToQueue: false, now: NOW })).toEqual({
      queue_status: "not_queued",
    });
    expect(resolveVideoExtractQueueIntent({ addToQueue: true, now: NOW })).toEqual({
      queue_status: "queued",
    });
    expect(
      resolveVideoExtractQueueIntent({
        addToQueue: true,
        initialReviewDate: "2026-10-29T00:00:00.000Z",
        now: NOW,
      }),
    ).toEqual({ queue_status: "queued" });
    expect(
      resolveVideoExtractQueueIntent({
        addToQueue: true,
        initialReviewDate: "2026-10-30T00:00:00.000Z",
        now: NOW,
      }),
    ).toEqual({ queue_status: "queued", next_review_date: "2026-10-30T00:00:00.000Z" });
    expect(() =>
      resolveVideoExtractQueueIntent({
        addToQueue: true,
        initialReviewDate: "2026-10-28T00:00:00.000Z",
        now: NOW,
      }),
    ).toThrow(/past/);
    expect(() =>
      resolveVideoExtractQueueIntent({
        addToQueue: false,
        initialReviewDate: "2026-10-30T00:00:00.000Z",
        now: NOW,
      }),
    ).toThrow(/requires/);
  });
});

describe("video extract status", () => {
  it("distinguishes new, seen-unreviewed, and reviewed", () => {
    expect(videoExtractLifecycleKind(extract())).toBe("new");
    expect(videoExtractLifecycleKind(extract({ first_seen_at: NOW.toISOString() }))).toBe(
      "seen_unreviewed",
    );
    expect(videoExtractLifecycleKind(extract({ last_viewed_at: NOW.toISOString() }))).toBe(
      "seen_unreviewed",
    );
    expect(videoExtractLifecycleKind(extract({ review_count: 2 }))).toBe("reviewed");
    expect(
      videoExtractLifecycleKind(
        extract({ last_reviewed_at: NOW.toISOString(), review_count: 0 }),
      ),
    ).toBe("reviewed");
    expect(
      videoExtractLifecycleKind(
        extract({
          last_viewed_at: NOW.toISOString(),
          last_reviewed_at: NOW.toISOString(),
          review_count: 0,
        }),
      ),
    ).toBe("reviewed");
  });

  it("mirrors queue eligibility including the reviewed-NULL guard", () => {
    expect(videoExtractQueueKind(extract({ queue_status: "not_queued" }))).toBe("not_queued");
    expect(videoExtractQueueKind(extract())).toBe("queued_new");
    expect(isVideoExtractQueueEligible(extract())).toBe(true);
    expect(videoExtractQueueKind(extract({ review_count: 1 }))).toBe("needs_schedule");
    expect(isVideoExtractQueueEligible(extract({ review_count: 1 }))).toBe(false);
    expect(
      videoExtractQueueKind(
        extract({ next_review_date: "2026-10-28T12:00:00.000Z", review_count: 1 }),
        NOW,
      ),
    ).toBe("queued_due");
    expect(
      videoExtractQueueKind(
        extract({ next_review_date: "2026-10-30T00:00:00.000Z" }),
        NOW,
      ),
    ).toBe("queued_scheduled");
  });
});
