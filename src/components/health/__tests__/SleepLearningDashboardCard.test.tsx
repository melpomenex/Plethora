import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSleepChart: vi.fn(),
  getLearningInsights: vi.fn(),
  addTab: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("../../../api/health", () => ({
  healthApi: {
    getSleepChart: mocks.getSleepChart,
    getLearningInsights: mocks.getLearningInsights,
  },
}));

vi.mock("../../../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/tauri")>("../../../lib/tauri");
  return { ...actual, isTauri: () => true };
});

vi.mock("../../../lib/platformCapabilities", () => ({
  isPlatformCapabilityAvailable: () => true,
}));

vi.mock("../../../stores/tabsStore", () => ({
  useTabsStore: (selector: (s: any) => any) => selector({ addTab: mocks.addTab }),
}));

vi.mock("../../../stores/healthStore", () => ({
  useHealthStore: (selector: (s: any) => any) =>
    selector({ demo: false, revision: 0, setView: mocks.setView }),
}));

vi.mock("../../tabs/TabRegistry", () => ({
  createCanonicalTab: (type: string) => ({ id: type, type, title: "Learning Insights" }),
}));

import { SleepLearningDashboardCard } from "../SleepLearningDashboardCard";

describe("SleepLearningDashboardCard (#2)", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getSleepChart.mockReset();
    mocks.getLearningInsights.mockReset();
    mocks.addTab.mockReset();
    mocks.setView.mockReset();
  });

  it("renders populated 7-day sleep metrics and opens Learning Insights", async () => {
    mocks.getSleepChart.mockResolvedValue({
      episodes: [{ id: "ep-1" }],
      daySummaries: [
        { localDate: "2026-11-15", mainSleepMins: 430, missingData: false },
        { localDate: "2026-11-16", mainSleepMins: null, missingData: true },
        { localDate: "2026-11-17", mainSleepMins: 460, missingData: false },
      ],
      rolling7d: {
        nightsTracked: 6,
        meanTotalSleepMins: 444,
        circularBedtimeSdMins: 28,
        sriProxy: null,
      },
    });
    mocks.getLearningInsights.mockResolvedValue({
      insights: [{ id: "i1", title: "Your sleep duration has been more consistent this week." }],
    });

    render(<SleepLearningDashboardCard />);

    expect(await screen.findByText("7h 24m")).toBeInTheDocument();
    expect(screen.getByText("±28m")).toBeInTheDocument();
    expect(screen.getByText("6/7")).toBeInTheDocument();
    expect(
      screen.getByText("Your sleep duration has been more consistent this week."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /View Learning Insights/i }));
    expect(mocks.addTab).toHaveBeenCalledTimes(1);
  });

  it("renders a dismissible empty state when no sleep records exist", async () => {
    mocks.getSleepChart.mockResolvedValue({
      episodes: [],
      daySummaries: [],
      rolling7d: { trackedNights: 0, meanSleepMins: null, bedtimeSdMins: null, sriProxy: null },
    });

    render(<SleepLearningDashboardCard />);

    expect(await screen.findByRole("button", { name: /Connect wearable/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss Sleep & Learning card/i }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Sleep & Learning/i })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("plethora.dashboard.hideSleepLearning")).toBe("1");
  });
});
