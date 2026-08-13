import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../../../test/utils";
import type {
  ItemStatsDetail,
  ItemStatsEvent,
  Metric,
  StatsItemType,
} from "../../../api/item-stats";

const api = vi.hoisted(() => ({
  getItemStatsDetail: vi.fn(),
  getItemStatsSummary: vi.fn(),
  previewReviewIntervals: vi.fn(),
}));

vi.mock("../../../api/item-stats", () => ({
  getItemStatsDetail: api.getItemStatsDetail,
  getItemStatsSummary: api.getItemStatsSummary,
  recordActiveTime: vi.fn(),
}));

vi.mock("../../../api/review", () => ({
  previewReviewIntervals: api.previewReviewIntervals,
  formatInterval: (days: number) => `${Math.round(days)} days`,
}));

// Translate against the real English dictionary rather than echoing keys: the
// assertions then read as the user-visible copy, and a key this component uses
// but never added to `en` fails here instead of shipping as a raw key.
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

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { learning: { leechThreshold: 8 } } }),
}));

// recharts needs a real layout box, which jsdom does not provide; the curves
// have their own screen-reader tables and are exercised through those.
vi.mock("../StatsCurves", () => ({
  IntervalGrowthChart: () => <div data-testid="interval-growth" />,
  RetentionCurveChart: () => <div data-testid="retention-curve" />,
}));

import { ItemStatsModal } from "../ItemStatsModal";

const value = <T,>(v: T): Metric<T> => ({ state: "value", value: v });
const untracked = <T,>(): Metric<T> => ({ state: "untracked" });
const notApplicable = <T,>(): Metric<T> => ({ state: "notApplicable" });

function event(overrides: Partial<ItemStatsEvent> = {}): ItemStatsEvent {
  return {
    at: "2026-03-01T10:00:00Z",
    activeSeconds: 60,
    surface: "queue",
    rating: 3,
    resultingIntervalDays: 4,
    progressDelta: null,
    ...overrides,
  };
}

function detail(itemType: StatsItemType, overrides: Partial<ItemStatsDetail> = {}): ItemStatsDetail {
  return {
    summary: {
      itemType,
      itemId: "item-1",
      totalActiveSeconds: value(8040),
      repetitions: value(6),
      averageSecondsPerRepetition: value(1340),
      firstInteractionAt: value("2026-03-01T10:00:00Z"),
      lastInteractionAt: value("2026-08-01T10:00:00Z"),
    },
    time: {
      totalActiveSeconds: value(8040),
      queueSeconds: value(3000),
      readerSeconds: value(5040),
      sessionCount: value(6),
      longestSessionSeconds: value(2400),
      averageSessionSeconds: value(1340),
      medianSessionSeconds: value(1200),
      estimatedReadingSeconds: value(9000),
    },
    schedule: {
      stability: value(12.5),
      difficulty: value(5.2),
      retrievability: value(0.86),
      currentIntervalDays: value(12),
      nextIntervalDays: value(30),
      dueDate: value("2026-09-01T00:00:00Z"),
      intervalModifier: value(1),
      intervalHistory: [
        { repetition: 1, intervalDays: 2 },
        { repetition: 2, intervalDays: 6 },
      ],
      retentionCurve: [
        { day: 0, retention: 1 },
        { day: 30, retention: 0.7 },
      ],
    },
    history: {
      events: [event(), event({ at: "2026-04-01T10:00:00Z", rating: 1 })],
      ratingDistribution: { again: 1, hard: 0, good: 1, easy: 0 },
      lapsePositions: [1],
      lapses: value(1),
      isLeech: false,
      leechThreshold: 8,
    },
    content: {
      createdAt: value("2026-01-01T00:00:00Z"),
      firstSeenAt: value("2026-03-01T00:00:00Z"),
      ageDays: value(224),
      wordCount: value(3200),
      characterCount: value(18000),
      progressPercent: value(42),
      extractsYielded: value(0),
      flashcardsYielded: value(4),
      priorityScore: value(63.5),
      prioritySlider: value(70),
      category: value("Research"),
      tags: ["biology", "memory"],
    },
    rankByTimeInvested: value({ rank: 2, total: 40 }),
    ...overrides,
  };
}

function renderModal(payload: ItemStatsDetail, itemType: StatsItemType = "document") {
  api.getItemStatsDetail.mockResolvedValue(payload);
  const onClose = vi.fn();
  const result = render(
    <ItemStatsModal itemType={itemType} itemId="item-1" title="Deep Work" onClose={onClose} />,
  );
  return { ...result, onClose };
}

describe("ItemStatsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.previewReviewIntervals.mockResolvedValue({ again: 1, hard: 3, good: 8, easy: 16 });
  });

  it("shows all four sections for a document that has been read and rated", async () => {
    renderModal(detail("document"));

    await screen.findByLabelText("Time");
    expect(screen.getByLabelText("Schedule")).toBeTruthy();
    expect(screen.getByLabelText("History")).toBeTruthy();
    expect(screen.getByLabelText("Content")).toBeTruthy();
  });

  it("omits the Schedule section entirely for an RSS article", async () => {
    renderModal(
      detail("rss", {
        time: null,
        schedule: null,
        history: null,
        content: null,
        rankByTimeInvested: notApplicable(),
      }),
      "rss",
    );

    await waitFor(() => expect(api.getItemStatsDetail).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading statistics...")).toBeNull());

    expect(screen.queryByLabelText("Schedule")).toBeNull();
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.getByText("Nothing has been recorded for this item yet.")).toBeTruthy();
  });

  it("builds the Time section from the split by surface", async () => {
    renderModal(detail("document"));

    const time = await screen.findByLabelText("Time");
    expect(within(time).getByText("2h 14m")).toBeTruthy();
    expect(within(time).getByText("50m 0s")).toBeTruthy();
    expect(within(time).getByText("1h 24m")).toBeTruthy();
    expect(within(time).getByText("40m 0s")).toBeTruthy();
    // Actual against estimated, the comparison a reader wants.
    expect(within(time).getByText("2h 14m / 2h 30m")).toBeTruthy();
  });

  it("builds the Schedule section with memory state and the per-rating preview", async () => {
    renderModal(detail("learning-item"), "learning-item");

    const schedule = await screen.findByLabelText("Schedule");
    expect(within(schedule).getByText("12.5")).toBeTruthy();
    expect(within(schedule).getByText("5.2")).toBeTruthy();
    expect(within(schedule).getByText("86%")).toBeTruthy();

    await waitFor(() =>
      expect(within(schedule).getByText("If you rate it")).toBeTruthy(),
    );
    expect(within(schedule).getByText("8 days")).toBeTruthy();
  });

  it("builds the History section as a chronological timeline with lapse markers", async () => {
    renderModal(detail("document"));

    const history = await screen.findByLabelText("History");
    const rows = within(history).getAllByRole("row");
    // One header row plus one row per event.
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(within(history).getAllByText(/Lapse/).length).toBeGreaterThan(0);
    expect(within(history).getByText("Lapses")).toBeTruthy();
  });

  it("flags a leech when the lapse count crosses the threshold", async () => {
    renderModal(
      detail("learning-item", {
        history: {
          events: [event({ rating: 1 })],
          ratingDistribution: { again: 9, hard: 0, good: 1, easy: 0 },
          lapsePositions: [0],
          lapses: value(9),
          isLeech: true,
          leechThreshold: 8,
        },
      }),
      "learning-item",
    );

    const indicator = await screen.findByTestId("leech-indicator");
    expect(within(indicator).getByText("Leech")).toBeTruthy();
    expect(within(indicator).getByText(/threshold of 8/)).toBeTruthy();
  });

  it("builds the Content section including a genuine zero", async () => {
    renderModal(detail("document"));

    const content = await screen.findByLabelText("Content");
    expect(within(content).getByText("3200")).toBeTruthy();
    expect(within(content).getByText("42%")).toBeTruthy();
    // No extracts made is a real zero, not an unknown.
    expect(within(content).getByText("0")).toBeTruthy();
    expect(within(content).getByText("biology")).toBeTruthy();
  });

  it("says a metric was not recorded rather than showing zero", async () => {
    renderModal(
      detail("document", {
        time: {
          totalActiveSeconds: untracked(),
          queueSeconds: untracked(),
          readerSeconds: untracked(),
          sessionCount: untracked(),
          longestSessionSeconds: untracked(),
          averageSessionSeconds: untracked(),
          medianSessionSeconds: untracked(),
          estimatedReadingSeconds: untracked(),
        },
      }),
    );

    const time = await screen.findByLabelText("Time");
    expect(within(time).getAllByText("Not recorded").length).toBe(8);
    expect(within(time).queryByText("0s")).toBeNull();
  });

  it("omits a metric that does not apply to the item type", async () => {
    renderModal(
      detail("extract", {
        time: {
          totalActiveSeconds: value(75),
          queueSeconds: value(75),
          readerSeconds: notApplicable(),
          sessionCount: value(2),
          longestSessionSeconds: value(45),
          averageSessionSeconds: value(37),
          medianSessionSeconds: value(37),
          estimatedReadingSeconds: notApplicable(),
        },
      }),
      "extract",
    );

    const time = await screen.findByLabelText("Time");
    expect(within(time).queryByText("In the Reader")).toBeNull();
    expect(within(time).queryByText("Estimated reading time")).toBeNull();
    expect(within(time).getByText("In the Queue")).toBeTruthy();
  });

  it("shows where the item ranks by time invested", async () => {
    renderModal(detail("document"));

    await screen.findByLabelText("Time");
    expect(screen.getByText("#2 of 40")).toBeTruthy();
  });

  it("refetches on open so a rating performed in between is reflected", async () => {
    const { unmount } = renderModal(detail("document"));
    await screen.findByLabelText("Time");
    expect(api.getItemStatsDetail).toHaveBeenCalledTimes(1);
    unmount();

    renderModal(detail("document"));
    await screen.findByLabelText("Time");
    expect(api.getItemStatsDetail).toHaveBeenCalledTimes(2);
  });
});

describe("ItemStatsModal accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.previewReviewIntervals.mockResolvedValue({ again: 1, hard: 3, good: 8, easy: 16 });
  });

  it("is a labelled modal dialog", async () => {
    renderModal(detail("document"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toContain("Deep Work");
  });

  it("moves focus into the dialog on open", async () => {
    renderModal(detail("document"));

    const close = await screen.findByLabelText("Close statistics");
    expect(document.activeElement).toBe(close);
  });

  it("keeps Tab inside the dialog", async () => {
    renderModal(detail("document"));
    const dialog = await screen.findByRole("dialog");
    const close = screen.getByLabelText("Close statistics");

    // Only the close button is focusable in this payload, so a Tab from it
    // must wrap back to itself rather than escaping to the page.
    close.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape so focus can return to the trigger", async () => {
    const { onClose } = renderModal(detail("document"));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives every stat a reachable label and every chart a text equivalent", async () => {
    renderModal(detail("document"));

    const history = await screen.findByLabelText("History");

    // The bars are aria-hidden; the same numbers live in a screen-reader table.
    const tables = within(history).getAllByRole("table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
    expect(
      tables.some((table) =>
        table.textContent?.includes("Data table:"),
      ),
    ).toBe(true);
  });
});
