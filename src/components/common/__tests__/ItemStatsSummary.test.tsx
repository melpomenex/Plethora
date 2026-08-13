import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/utils";
import type { ItemStatsSummary, Metric, StatsItemType } from "../../../api/item-stats";

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

import { ItemStatsSummaryBlock } from "../ItemStatsSummary";

const value = <T,>(v: T): Metric<T> => ({ state: "value", value: v });
const untracked = <T,>(): Metric<T> => ({ state: "untracked" });
const notApplicable = <T,>(): Metric<T> => ({ state: "notApplicable" });

function summary(
  itemType: StatsItemType,
  overrides: Partial<ItemStatsSummary> = {},
): ItemStatsSummary {
  return {
    itemType,
    itemId: "item-1",
    totalActiveSeconds: value(8040),
    repetitions: value(6),
    averageSecondsPerRepetition: value(1340),
    firstInteractionAt: value("2026-03-01T10:00:00Z"),
    lastInteractionAt: value("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

describe("ItemStatsSummaryBlock", () => {
  it("shows total time, repetitions, and average for a document", () => {
    render(<ItemStatsSummaryBlock summary={summary("document")} isLoading={false} />);

    expect(screen.getByText("Total time")).toBeTruthy();
    expect(screen.getByText("2h 14m")).toBeTruthy();
    expect(screen.getByText("Repetitions")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("Avg. per rep")).toBeTruthy();
    expect(screen.getByText("22m")).toBeTruthy();
  });

  it("shows the same three values for a flashcard", () => {
    render(
      <ItemStatsSummaryBlock
        summary={summary("learning-item", {
          totalActiveSeconds: value(51),
          repetitions: value(3),
          averageSecondsPerRepetition: value(17),
        })}
        isLoading={false}
      />,
    );

    expect(screen.getByText("51s")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("17s")).toBeTruthy();
  });

  it("shows an extract's recorded time and review count", () => {
    render(
      <ItemStatsSummaryBlock
        summary={summary("extract", {
          totalActiveSeconds: value(75),
          repetitions: value(2),
          averageSecondsPerRepetition: value(37),
        })}
        isLoading={false}
      />,
    );

    // The summary uses the compact format, so 75 seconds reads as "1m".
    expect(screen.getByText("1m")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("37s")).toBeTruthy();
  });

  it("renders nothing at all when every metric is not-applicable, as for RSS", () => {
    const { container } = render(
      <ItemStatsSummaryBlock
        summary={summary("rss", {
          totalActiveSeconds: notApplicable(),
          repetitions: notApplicable(),
          averageSecondsPerRepetition: notApplicable(),
          firstInteractionAt: notApplicable(),
          lastInteractionAt: notApplicable(),
        })}
        isLoading={false}
      />,
    );

    expect(container.querySelector('[data-testid="item-stats-summary"]')).toBeNull();
  });

  it("says a metric was not recorded rather than showing zero", () => {
    render(
      <ItemStatsSummaryBlock
        summary={summary("document", {
          totalActiveSeconds: untracked(),
          repetitions: untracked(),
          averageSecondsPerRepetition: untracked(),
          firstInteractionAt: untracked(),
        })}
        isLoading={false}
      />,
    );

    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.queryByText("0s")).toBeNull();
    expect(screen.getByText("This item was reviewed before per-item time was recorded.")).toBeTruthy();
  });

  it("shows a genuine zero as a real value", () => {
    render(
      <ItemStatsSummaryBlock
        summary={summary("document", { totalActiveSeconds: value(0), repetitions: value(0) })}
        isLoading={false}
      />,
    );

    expect(screen.getAllByText("0s").length).toBeGreaterThan(0);
    expect(screen.queryByText("Not recorded")).toBeNull();
  });

  it("shows its own loading state without hiding the rest of the popover", () => {
    render(<ItemStatsSummaryBlock summary={null} isLoading />);

    expect(screen.getByText("Loading statistics...")).toBeTruthy();
    // The summary heading is present even while loading, so the block does not
    // pop into existence and shift the popover's layout when data lands.
    expect(screen.getByText("Investment")).toBeTruthy();
  });

  it("surfaces an error without breaking the popover", () => {
    render(<ItemStatsSummaryBlock summary={null} isLoading={false} error="boom" />);

    expect(screen.getByText("Failed to load statistics")).toBeTruthy();
  });

  it("dates the investment when the first interaction is known", () => {
    render(<ItemStatsSummaryBlock summary={summary("document")} isLoading={false} />);

    expect(screen.getByText(/Invested since/)).toBeTruthy();
  });

  it("keeps the summary to at most six values", () => {
    const { container } = render(
      <ItemStatsSummaryBlock summary={summary("document")} isLoading={false} />,
    );

    const block = container.querySelector('[data-testid="item-stats-summary"]');
    // Three grid cells plus the one "invested since" line — well inside the
    // six-value ceiling that keeps the block scroll-free in the 384px panel
    // and the mobile bottom sheet.
    const gridCells = block?.querySelectorAll(".grid > div") ?? [];
    expect(gridCells.length).toBeLessThanOrEqual(6);
    expect(gridCells.length).toBe(3);
  });
});
