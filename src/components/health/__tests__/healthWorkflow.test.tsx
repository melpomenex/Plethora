import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { healthApi } from "../../../api/health";
import { useHealthStore } from "../../../stores/healthStore";
import { LearningInsightsTab } from "../../tabs/LearningInsightsTab";
import { DataSourcesPanel } from "../DataSourcesPanel";
import { PersonalPatternsPanel } from "../PersonalPatternsPanel";
import { healthConnectFixture, learningReportFixture, sleepChartFixture } from "./healthFixtures";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  listen: async () => () => undefined,
}));
vi.mock("../../../api/health", () => ({
  healthApi: {
    getSleepChart: vi.fn(),
    loadDemo: vi.fn(),
    clearDemo: vi.fn(),
    listProviders: vi.fn(),
    getConnections: vi.fn(),
    getSourcePreferences: vi.fn(),
    getConsentLog: vi.fn(),
    connectNative: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  useHealthStore.setState({ view: "overview", demo: false, plan: "", range: null });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value(this: HTMLDialogElement) { this.open = false; },
  });
});

describe("local health workflows", () => {
  it("opens with real empty data and only loads sample records after opt-in", async () => {
    vi.mocked(healthApi.getSleepChart).mockResolvedValueOnce(sleepChartFixture())
      .mockResolvedValue(sleepChartFixture(true, true));
    const { unmount } = render(<LearningInsightsTab />);
    await screen.findByText("Start with a night of sleep");
    expect(healthApi.loadDemo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Explore sample data" }));
    await screen.findByText("Sample data.");
    expect(healthApi.loadDemo).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Log sleep" })).toBeDisabled();
    unmount();
  });

  it("explains an unavailable cloud provider and preserves consent choices after denial", async () => {
    vi.mocked(healthApi.listProviders).mockResolvedValue([healthConnectFixture, {
      ...healthConnectFixture, id: "oura", displayName: "Oura", category: "cloud_oauth",
      readinessState: "temporarily_unavailable", readinessReason: "The broker is offline.",
    }]);
    vi.mocked(healthApi.getConnections).mockResolvedValue([]);
    vi.mocked(healthApi.getSourcePreferences).mockResolvedValue([]);
    vi.mocked(healthApi.getConsentLog).mockResolvedValue([]);
    vi.mocked(healthApi.connectNative).mockRejectedValue(new Error("Health Connect permission was denied."));
    const { unmount } = render(<DataSourcesPanel settings />);
    await screen.findByText(/The broker is offline/);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    const consent = screen.getByRole("dialog", { name: "Connect Health Connect" });
    fireEvent.click(within(consent).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(consent).getByRole("checkbox", { name: "Heart rate" }));
    fireEvent.click(within(consent).getByRole("button", { name: "Authorize" }));
    expect(await within(consent).findByRole("alert")).toHaveTextContent("permission was denied");
    expect(healthApi.connectNative).toHaveBeenCalledWith("android_health_connect", ["sleep", "heart_rate"], false);
    unmount();
  });

  it("shows paired sample sizes, coverage and limitations in the evidence dialog", () => {
    const { unmount } = render(<PersonalPatternsPanel report={learningReportFixture("biology")} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect evidence" }));
    expect(screen.getByRole("dialog", { name: "Biology recall and sleep" })).toHaveTextContent("Observational data.");
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
  });
});
