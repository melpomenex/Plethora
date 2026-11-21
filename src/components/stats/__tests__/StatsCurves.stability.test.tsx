import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemStatsDetail, Metric } from "../../../api/item-stats";

const api = vi.hoisted(() => ({
  getItemStatsDetail: vi.fn(),
  getItemStatsSummary: vi.fn(),
}));

vi.mock("../../../api/item-stats", () => ({
  getItemStatsDetail: api.getItemStatsDetail,
  getItemStatsSummary: api.getItemStatsSummary,
  recordActiveTime: vi.fn(),
}));

vi.mock("../../../api/review", () => ({
  previewReviewIntervals: vi.fn().mockResolvedValue(null),
  formatInterval: (days: number) => `${Math.round(days)} days`,
}));

vi.mock("../../../lib/i18n", async () => {
  const { en } = await vi.importActual<typeof import("../../../lib/i18n/locales/en")>(
    "../../../lib/i18n/locales/en",
  );
  return {
    useI18n: () => ({
      t: (key: string, vars?: Record<string, string | number>) => {
        const template = en[key] ?? key;
        return vars
          ? template.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k]))
          : template;
      },
      locale: "en",
    }),
  };
});

import { ItemStatsButton } from "../ItemStatsButton";
import { ItemStatsModal } from "../ItemStatsModal";

const val = <T,>(v: T): Metric<T> => ({ state: "value", value: v });

const sampleDetail: ItemStatsDetail = {
  summary: {
    itemType: "document",
    itemId: "pdf-1",
    totalActiveSeconds: val(600),
    repetitions: val(3),
    averageSecondsPerRepetition: val(200),
    firstInteractionAt: val("2026-03-01T10:00:00Z"),
    lastInteractionAt: val("2026-04-01T10:00:00Z"),
  },
  time: {
    totalActiveSeconds: val(600),
    queueSeconds: val(200),
    readerSeconds: val(400),
    sessionCount: val(3),
    longestSessionSeconds: val(300),
    averageSessionSeconds: val(200),
    medianSessionSeconds: val(200),
    estimatedReadingSeconds: val(1200),
  },
  schedule: {
    stability: val(8.2),
    difficulty: val(4.5),
    retrievability: val(0.91),
    currentIntervalDays: val(7),
    nextIntervalDays: val(14),
    dueDate: val("2026-04-15T00:00:00Z"),
    intervalModifier: val(1),
    intervalHistory: [
      { repetition: 1, intervalDays: 1 },
      { repetition: 2, intervalDays: 4 },
      { repetition: 3, intervalDays: 7 },
    ],
    retentionCurve: [
      { day: 0, retention: 1 },
      { day: 7, retention: 0.9 },
      { day: 14, retention: 0.82 },
    ],
  },
  history: {
    events: [],
    ratingDistribution: { again: 0, hard: 0, good: 3, easy: 0 },
    lapsePositions: [],
    lapses: val(0),
    isLeech: false,
    leechThreshold: 8,
  },
  content: null,
  rankByTimeInvested: { state: "untracked" },
};

describe("Statistics modal stability and containment (#11)", () => {
  beforeEach(() => {
    api.getItemStatsDetail.mockReset();
    // Simulate a real ResizeObserver firing with non-zero box dimensions.
    globalThis.ResizeObserver = class ResizeObserver {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        this.cb(
          [
            {
              target,
              contentRect: { width: 320, height: 140, top: 0, left: 0, bottom: 140, right: 320, x: 0, y: 0, toJSON: () => ({}) },
            } as ResizeObserverEntry,
          ],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    };
  });

  it("renders ItemStatsModal with real unmocked StatsCurves without maximum update depth errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getItemStatsDetail.mockResolvedValue(sampleDetail);

    render(
      <ItemStatsModal
        itemType="document"
        itemId="pdf-1"
        title="Sample PDF"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(api.getItemStatsDetail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Interval growth")).toBeInTheDocument();
    expect(screen.getAllByText(/Retention/i).length).toBeGreaterThanOrEqual(1);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    consoleError.mockRestore();
  });

  it("contains modal errors inside ItemStatsButton without crashing the parent reader", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getItemStatsDetail.mockImplementation(() => {
      throw new Error("Simulated stats failure");
    });

    render(
      <div>
        <div data-testid="reader-surface">Active PDF Reader</div>
        <ItemStatsButton itemType="document" itemId="pdf-1" title="Sample PDF" />
      </div>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /statistics/i }));
    });

    expect(screen.getByTestId("reader-surface")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
