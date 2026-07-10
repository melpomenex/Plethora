import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "../../../test/utils";
import { useSettingsStore } from "../../../stores/settingsStore";
import { createTabPane, useTabsStore } from "../../../stores/tabsStore";
import { requestApplicationBack } from "../../../lib/applicationBack";
import { resetContextualBackHandlersForTests } from "../../../lib/contextualBack";
import { resetOverlayStackForTests } from "../../../lib/overlayStack";
import { SettingsPage } from "../SettingsPage";

const presentation = vi.hoisted(() => ({ mobile: false }));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => presentation.mobile,
}));

vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/tauri")>()),
  isTauri: () => false,
}));

const DummyTab = () => null;

function openSettingsWithPrevious() {
  const documentsId = useTabsStore.getState().addTab({
    title: "Documents",
    icon: null,
    type: "documents",
    content: DummyTab,
    closable: true,
  });
  const settingsId = useTabsStore.getState().addTab({
    title: "Settings",
    icon: null,
    type: "settings",
    content: DummyTab,
    closable: true,
  });
  return { documentsId, settingsId };
}

describe("SettingsPage return navigation", () => {
  beforeEach(() => {
    presentation.mobile = false;
    localStorage.removeItem("incrementum_settings_initial_tab");
    resetContextualBackHandlersForTests();
    resetOverlayStackForTests();
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
      forwardTabHistory: [],
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: { ...state.settings.general, language: "en" },
      },
    }));
    vi.restoreAllMocks();
  });

  it("shows the prior destination on wide layouts and returns by keyboard-compatible button activation", () => {
    const { documentsId } = openSettingsWithPrevious();
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Documents" }));

    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(documentsId);
  });

  it("keeps section hierarchy distinct from direct app return on compact layouts", () => {
    presentation.mobile = true;
    const { documentsId, settingsId } = openSettingsWithPrevious();
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("button", { name: "Back to settings menu" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Back to Documents" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Back to settings menu" }));
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(settingsId);
    expect(screen.getByRole("button", { name: "Back to settings menu" }).closest("div.flex-1")).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    const appReturnButtons = screen.getAllByRole("button", { name: "Back to Documents" });
    fireEvent.click(appReturnButtons[appReturnButtons.length - 1]);
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(documentsId);
  });

  it("uses the generic fallback label and requests Dashboard without prior history", () => {
    useTabsStore.getState().addTab({ title: "Settings", icon: null, type: "settings", content: DummyTab, closable: true });
    const navigate = vi.fn();
    window.addEventListener("navigate", navigate);
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe("/dashboard");
    window.removeEventListener("navigate", navigate);
  });

  it("keeps the current section and history when unsaved back is cancelled", () => {
    presentation.mobile = true;
    const { settingsId } = openSettingsWithPrevious();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "review" } });
    const historyBefore = [...useTabsStore.getState().activeTabHistory];

    expect(requestApplicationBack()).toBe(true);

    expect(confirm).toHaveBeenCalledOnce();
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(settingsId);
    expect(useTabsStore.getState().activeTabHistory).toEqual(historyBefore);
    expect(screen.getByRole("button", { name: "Back to settings menu" })).toBeInTheDocument();
  });

  it("performs exactly one guarded transition after unsaved back is confirmed", async () => {
    presentation.mobile = true;
    openSettingsWithPrevious();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "review" } });

    act(() => {
      expect(requestApplicationBack()).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to settings menu" }).closest("div.flex-1")).toHaveClass("hidden");
    });
    expect((useTabsStore.getState().rootPane as any).activeTabId).toBe(
      useTabsStore.getState().tabs.find((tab) => tab.type === "settings")?.id,
    );
  });
});
