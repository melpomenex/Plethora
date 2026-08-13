import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../../test/utils";

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

vi.mock("../StatsCurves", () => ({
  IntervalGrowthChart: () => <div />,
  RetentionCurveChart: () => <div />,
}));

import { ItemStatsButton } from "../ItemStatsButton";

const emptyDetail = {
  summary: {
    itemType: "document" as const,
    itemId: "doc-1",
    totalActiveSeconds: { state: "untracked" as const },
    repetitions: { state: "untracked" as const },
    averageSecondsPerRepetition: { state: "untracked" as const },
    firstInteractionAt: { state: "untracked" as const },
    lastInteractionAt: { state: "untracked" as const },
  },
  time: null,
  schedule: null,
  history: null,
  content: null,
  rankByTimeInvested: { state: "notApplicable" as const },
};

describe("ItemStatsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getItemStatsDetail.mockResolvedValue(emptyDetail);
  });

  it("opens the same statistics view from any surface", async () => {
    render(<ItemStatsButton itemType="document" itemId="doc-1" title="Deep Work" />);

    fireEvent.click(screen.getByLabelText("Statistics"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toContain("Deep Work");
    await waitFor(() =>
      expect(api.getItemStatsDetail).toHaveBeenCalledWith("document", "doc-1", 8),
    );
  });

  it("returns focus to the trigger when the view is dismissed", async () => {
    render(<ItemStatsButton itemType="learning-item" itemId="card-1" title="A card" />);
    const trigger = screen.getByLabelText("Statistics");

    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps its accessible name when rendered icon-only", () => {
    render(<ItemStatsButton itemType="document" itemId="doc-1" title="Deep Work" iconOnly />);

    const trigger = screen.getByLabelText("Statistics");
    expect(trigger.textContent).toBe("");
    expect(trigger.getAttribute("title")).toBe("Statistics");
  });

  it("does not load the statistics module until asked", () => {
    render(<ItemStatsButton itemType="document" itemId="doc-1" title="Deep Work" />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.getItemStatsDetail).not.toHaveBeenCalled();
  });
});
