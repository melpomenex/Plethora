import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SmartFeedsDecisionModelControl } from "../SmartFeedsDecisionModelControl";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { LAYA_PROVIDER_ID, OPENROUTER_DECISIONS_PROVIDER_ID } from "../../../../lib/daqe/decisionModelOptions";

const startLayaServerMock = vi.fn();
const stopLayaServerMock = vi.fn();
const getLayaServerStatusMock = vi.fn();

vi.mock("../../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => true,
    isNativeMobile: () => false,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../../../../api/layaRuntime", () => ({
  getLayaServerStatus: (...args: unknown[]) => getLayaServerStatusMock(...args),
  startLayaServer: (...args: unknown[]) => startLayaServerMock(...args),
  stopLayaServer: (...args: unknown[]) => stopLayaServerMock(...args),
}));

vi.mock("../../../../stores/smartFeedsStore", () => ({
  useSmartFeedsStore: {
    getState: () => ({
      loadCapabilities: vi.fn().mockResolvedValue(null),
    }),
  },
}));

describe("SmartFeedsDecisionModelControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLayaServerStatusMock.mockResolvedValue({
      phase: "stopped",
      running: false,
      managed: false,
      endpoint: "http://127.0.0.1:8000",
      detail: null,
    });
    startLayaServerMock.mockResolvedValue({
      phase: "running",
      running: true,
      managed: true,
      endpoint: "http://127.0.0.1:8000",
      detail: null,
    });
    stopLayaServerMock.mockResolvedValue({
      phase: "stopped",
      running: false,
      managed: false,
      endpoint: "http://127.0.0.1:8000",
      detail: null,
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        daqe: {
          ...state.settings.daqe,
          decisionModelProviderId: LAYA_PROVIDER_ID,
          rankingEnabled: false,
          autoStartLaya: false,
        },
      },
    }));
  });

  it("lets the user start Laya directly from RSS View without opening Customize Session", async () => {
    render(<SmartFeedsDecisionModelControl variant="pill" />);

    const startBtn = await screen.findByRole("button", { name: /Start Laya/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(startLayaServerMock).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the Decision Model modal from RSS View so users can pick any decision model or auto-launch", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        daqe: {
          ...state.settings.daqe,
          decisionModelProviderId: OPENROUTER_DECISIONS_PROVIDER_ID,
        },
      },
    }));

    render(<SmartFeedsDecisionModelControl variant="pill" />);

    const configureBtn = screen.getByRole("button", { name: /OpenRouter decision models/i });
    fireEvent.click(configureBtn);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
