import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "../../../../test/utils";
import { ThemeProvider } from "../../../../contexts/ThemeContext";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { createTabPane, useTabsStore } from "../../../../stores/tabsStore";
import { requestApplicationBack } from "../../../../lib/applicationBack";
import { resetContextualBackHandlersForTests } from "../../../../lib/contextualBack";
import { resetOverlayStackForTests } from "../../../../lib/overlayStack";
import { SettingsPage } from "../../SettingsPage";

vi.mock("../../../../lib/feedback/orchestrator", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitInteractionFeedback: vi.fn(() => ({ channels: ["haptic"] })),
}));
vi.mock("../../../../lib/feedback/haptics/service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getHapticsSnapshot: () => ({ configured: true, capabilities: { hardware: "available" } }),
}));

const presentation = vi.hoisted(() => ({ mobile: false }));

const modalMock = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  prompt: vi.fn(async () => null),
  alert: vi.fn(async () => true),
}));

vi.mock("../../../common/Modal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModal: () => modalMock,
}));

vi.mock("../../../../hooks/useMobileShell", () => ({
  useMobileShell: () => presentation.mobile,
}));

vi.mock("../../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/tauri")>()),
  isTauri: () => false,
}));

const DummyTab = () => null;

function openSettings() {
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

function searchField() {
  return screen.getByLabelText("Search settings") as HTMLInputElement;
}

function typeSearch(value: string) {
  fireEvent.change(searchField(), { target: { value } });
}

async function clickResult(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  fireEvent.click(button);
  return button;
}

function arrivalTarget(targetId: string): HTMLElement | null {
  return document.querySelector(`[data-settings-search-target="${targetId}"]`);
}

describe("SettingsPage search", () => {
  beforeEach(() => {
    presentation.mobile = false;
    localStorage.removeItem("plethora_settings_initial_tab");
    resetContextualBackHandlersForTests();
    resetOverlayStackForTests();
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
    });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: { ...state.settings.general, language: "en", defaultView: "queue" },
        appearance: { ...state.settings.appearance, fontSize: 16 },
        interface: { ...state.settings.interface, companion: { ...state.settings.interface.companion, enabled: false } },
      },
    }));
    modalMock.confirm.mockReset();
    modalMock.confirm.mockResolvedValue(true);
  });

  it("shows specific settings and breadcrumbs instead of only categories", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("font size");

    const results = await screen.findAllByRole("button", { name: /Font Size, (Appearance|Documents)/ });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: /Font Size, Appearance/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Font Size, Documents/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("results");
  });

  it("reveals the interface font-size target without changing its value", async () => {
    openSettings();
    const before = useSettingsStore.getState().settings.appearance.fontSize;
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("font size");
    await clickResult(/^Font Size, Appearance/);

    await waitFor(() => {
      const target = arrivalTarget("appearance.fontSize");
      expect(target).toHaveAttribute("data-settings-search-arrival", "true");
      expect(target?.textContent).toContain("Search match");
    });
    expect(document.activeElement).toBe(arrivalTarget("appearance.fontSize"));
    expect(useSettingsStore.getState().settings.appearance.fontSize).toBe(before);
  });

  it("opens the Documents panel and reveals the EPUB font-size control", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("EPUB font size");
    await clickResult(/^Default Font Size, Documents › EPUB Documents/);

    await waitFor(() => {
      const target = arrivalTarget("documents.epubFontSize");
      expect(target).toHaveAttribute("data-settings-search-arrival", "true");
      expect(document.activeElement).toBe(target);
    });
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  });

  it("keeps the current view and draft when discard is declined", async () => {
    presentation.mobile = true;
    openSettings();
    modalMock.confirm.mockResolvedValue(false);
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "General" }));

    const defaultView = screen.getAllByRole("combobox")[1];
    fireEvent.change(defaultView, { target: { value: "review" } });
    typeSearch("volume buttons");
    await clickResult(/Volume Rocker Scroll, Appearance/);

    await waitFor(() => expect(modalMock.confirm).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(searchField().value).toBe("volume buttons");
    expect(screen.getByRole("button", { name: /Volume Rocker Scroll, Appearance/ })).toBeInTheDocument();
    expect(useSettingsStore.getState().settings.general.defaultView).toBe("review");
  });

  it("clears search, restores category navigation, and focuses the field", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("font size");
    const clear = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(clear);

    await waitFor(() => expect(searchField()).toHaveFocus());
    expect(searchField().value).toBe("");
    expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  });

  it("shows no-results recovery and does not fabricate a destination", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("xyzzy private value");
    expect(await screen.findByText(/No settings found/)).toBeInTheDocument();
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search match/ })).not.toBeInTheDocument();

    const clearButtons = screen.getAllByRole("button", { name: "Clear search" });
    fireEvent.click(clearButtons[clearButtons.length - 1]);
    await waitFor(() => expect(searchField()).toHaveFocus());
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
  });

  it("treats whitespace-only input as a blank query", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("   ");
    expect(screen.queryByText(/No settings found/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  });

  it("does not move focus while typing or during IME composition", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    const field = searchField();
    field.focus();
    fireEvent.compositionStart(field);
    typeSearch("font size");
    fireEvent.compositionEnd(field);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("font size");
    expect(arrivalTarget("appearance.fontSize")).toBeNull();
  });

  it("restores query, scroll, and result focus on compact hierarchical back", async () => {
    presentation.mobile = true;
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("font size");
    const result = await screen.findByRole("button", { name: /^Font Size, Appearance/ });
    fireEvent.click(result);

    await waitFor(() => expect(arrivalTarget("appearance.fontSize")).not.toBeNull());
    act(() => {
      expect(requestApplicationBack()).toBe(true);
    });

    await waitFor(() => {
      expect(searchField().value).toBe("font size");
      expect(screen.getByRole("button", { name: /^Font Size, Appearance/ })).toHaveFocus();
    });
  });

  it("lets a newer result supersede an in-flight reveal", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("font size");
    const first = await screen.findByRole("button", { name: /^Font Size, Appearance/ });
    const second = screen.getByRole("button", { name: /Default Font Size, Documents/ });
    fireEvent.click(first);
    fireEvent.click(second);

    await waitFor(() => {
      expect(arrivalTarget("documents.epubFontSize")).toHaveAttribute(
        "data-settings-search-arrival",
        "true",
      );
    });
    expect(document.activeElement).toBe(arrivalTarget("documents.epubFontSize"));
    expect(arrivalTarget("appearance.fontSize")).toBeNull();
  });

  it("keeps two Settings instances isolated", async () => {
    openSettings();
    const first = render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    const second = render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    const firstField = within(first.container).getByLabelText("Search settings");
    fireEvent.change(firstField, { target: { value: "font size" } });
    const result = await within(first.container).findByRole("button", { name: /^Font Size, Appearance/ });
    fireEvent.click(result);

    await waitFor(() => {
      const target = first.container.querySelector(
        '[data-settings-search-target="appearance.fontSize"]',
      );
      expect(target).toHaveAttribute("data-settings-search-arrival", "true");
    });
    expect(
      second.container.querySelector('[data-settings-search-arrival="true"]'),
    ).toBeNull();
    expect(document.activeElement).not.toBeNull();
    expect(second.container.contains(document.activeElement)).toBe(false);
  });

  it("opens a nested provider tab before focusing its configuration without changing settings", async () => {
    openSettings();
    const before = JSON.stringify(useSettingsStore.getState().settings.audioTranscription);
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("groq api key");
    await clickResult(/^API Configuration, Audio Transcription › Groq Cloud/);

    await waitFor(() => {
      const target = arrivalTarget("audioTranscription.apiConfig");
      expect(target).toHaveAttribute("data-settings-search-arrival", "true");
      expect(document.activeElement).toBe(target);
    });
    expect(JSON.stringify(useSettingsStore.getState().settings.audioTranscription)).toBe(before);
    expect(screen.getAllByRole("heading", { name: "Audio Transcription" }).length).toBeGreaterThan(0);
  });

  it("omits account destinations while Plethora Cloud is unavailable", async () => {
    openSettings();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    typeSearch("account subscription billing");
    expect(screen.queryByRole("button", { name: /Account/ })).not.toBeInTheDocument();
  });
});
