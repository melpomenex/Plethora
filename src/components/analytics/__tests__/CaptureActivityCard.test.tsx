/**
 * CaptureActivityCard state coverage (dashboard-capture-activity spec):
 * loading skeleton, error + retry, empty state, sparkline with data, and the
 * needs-attention row that deep-links to the import-needs-review tab.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../../test/utils";

// Translate against the real English dictionary so the assertions read as the
// user-visible copy, and a key this component uses but never added to `en`
// fails here instead of shipping as a raw key.
vi.mock("../../../lib/i18n", async () => {
  const { en } = await vi.importActual<typeof import("../../../lib/i18n/locales/en")>(
    "../../../lib/i18n/locales/en",
  );
  return {
    useI18n: () => ({
      t: (key: string, vars?: Record<string, string | number>) => {
        const template = en[key];
        if (template === undefined) throw new Error(`Missing i18n key: ${key}`);
        return vars
          ? template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k]))
          : template;
      },
      locale: "en",
    }),
  };
});

import { CaptureActivityCard } from "../CaptureActivityCard";
import type { CaptureActivity } from "../../../api/capture-activity";

function activity(overrides: Partial<CaptureActivity> = {}): CaptureActivity {
  return {
    windowDays: 30,
    perDay: [
      { date: "2026-09-05", count: 2 },
      { date: "2026-09-06", count: 1 },
    ],
    bySource: [
      { source: "browser-extension", count: 2 },
      { source: "share-target", count: 0 },
      { source: "rss", count: 0 },
      { source: "manual", count: 1 },
    ],
    needsAttention: 0,
    ...overrides,
  };
}

describe("CaptureActivityCard", () => {
  it("shows a loading skeleton without data", () => {
    render(
      <CaptureActivityCard
        data={null}
        isLoading
        error={null}
        onRetry={vi.fn()}
        onOpenNeedsReview={vi.fn()}
      />,
    );
    expect(screen.getByText("Capture Activity")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("renders the error state with a working retry affordance", () => {
    const onRetry = vi.fn();
    render(
      <CaptureActivityCard
        data={null}
        isLoading={false}
        error="db unavailable"
        onRetry={onRetry}
        onOpenNeedsReview={vi.fn()}
      />,
    );

    expect(screen.getByText(/Couldn't load capture activity/)).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when there are no captures", () => {
    render(
      <CaptureActivityCard
        data={activity({
          perDay: [{ date: "2026-09-06", count: 0 }],
          bySource: [
            { source: "browser-extension", count: 0 },
            { source: "share-target", count: 0 },
            { source: "rss", count: 0 },
            { source: "manual", count: 0 },
          ],
        })}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenNeedsReview={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No captures yet\. Save a page with the browser extension/),
    ).toBeTruthy();
  });

  it("renders sparkline bars, per-source counts, and the window summary", () => {
    render(
      <CaptureActivityCard
        data={activity()}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenNeedsReview={vi.fn()}
      />,
    );

    expect(
      screen.getByText("3 captured in the last 30 days"),
    ).toBeTruthy();
    // Per-day titles drive the sparkline bars.
    expect(screen.getByTitle("2026-09-05: 2")).toBeTruthy();
    expect(screen.getByTitle("2026-09-06: 1")).toBeTruthy();
    // Source labels resolve against the real en dictionary.
    expect(screen.getByText("Browser Extension")).toBeTruthy();
    expect(screen.getByText("Manual & local imports")).toBeTruthy();
    // No needs-attention row when the count is zero.
    expect(screen.queryByText(/need tag review/)).toBeNull();
  });

  it("shows the needs-attention row and deep-links on click", () => {
    const onOpenNeedsReview = vi.fn();
    render(
      <CaptureActivityCard
        data={activity({ needsAttention: 2 })}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenNeedsReview={onOpenNeedsReview}
      />,
    );

    fireEvent.click(screen.getByText("2 need tag review"));
    expect(onOpenNeedsReview).toHaveBeenCalledTimes(1);
  });
});
