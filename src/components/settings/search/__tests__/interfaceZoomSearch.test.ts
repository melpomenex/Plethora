import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "../../../../test/utils";
import { ThemeProvider } from "../../../../contexts/ThemeContext";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { createTabPane, useTabsStore } from "../../../../stores/tabsStore";
import { resetContextualBackHandlersForTests } from "../../../../lib/contextualBack";
import { resetOverlayStackForTests } from "../../../../lib/overlayStack";

vi.mock("../../../../lib/platformCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/platformCapabilities")>()),
  resolveCurrentAppPlatform: () => "desktop",
}));

vi.mock("../../../../lib/interfaceZoom/native", () => ({
  isDesktopInterfaceZoomSupported: () => true,
  applyNativeInterfaceZoom: async () => {},
}));

vi.mock("../../../../lib/feedback/orchestrator", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitInteractionFeedback: vi.fn(() => ({ channels: ["haptic"] })),
}));
vi.mock("../../../../lib/feedback/haptics/service", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getHapticsSnapshot: () => ({ configured: true, capabilities: { hardware: "available" } }),
}));

vi.mock("../../../common/Modal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModal: () => ({
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => null),
    alert: vi.fn(async () => true),
  }),
}));

vi.mock("../../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/tauri")>()),
  isTauri: () => false,
}));

import {
  SETTINGS_SEARCH_ENTRIES,
  createSettingsSearchAvailabilitySnapshot,
  isSettingsSearchEntryAvailable,
  type SettingsSearchAvailabilitySnapshot,
} from "../settingsSearchCatalog";
import { resolveSettingsSearchCatalog, searchSettings } from "../settingsSearch";
import { SETTINGS_SEARCH_COVERAGE } from "../settingsSearchCoverage";
import { SettingsTab } from "../../settingsSections";
import { en } from "../../../../lib/i18n/locales/en";
import { SettingsPage } from "../../SettingsPage";

function desktop(
  overrides: Partial<SettingsSearchAvailabilitySnapshot> = {},
): SettingsSearchAvailabilitySnapshot {
  return {
    cloudAvailable: false,
    platform: "desktop",
    appUpdaterAvailable: true,
    browserExtensionAvailable: true,
    notebooklmAvailable: true,
    onDeviceAiAvailable: false,
    companionEnabled: false,
    fsrsEnabled: false,
    daqeEnabled: false,
    ttsProvider: "system",
    ...overrides,
  };
}

function catalog(availability: SettingsSearchAvailabilitySnapshot) {
  return resolveSettingsSearchCatalog(SETTINGS_SEARCH_ENTRIES, {
    translate: (key) => en[key] ?? key,
    availability,
  });
}

function idsFor(query: string, availability = desktop()) {
  return searchSettings(catalog(availability), query).map((result) => result.entry.entry.id);
}

const DummyTab = () => null;

function openSettings() {
  useTabsStore.getState().addTab({
    title: "Settings",
    icon: null,
    type: "settings",
    content: DummyTab,
    closable: true,
  });
}

function searchField() {
  return screen.getByLabelText("Search settings") as HTMLInputElement;
}

function arrivalTarget(targetId: string): HTMLElement | null {
  return document.querySelector(`[data-settings-search-target="${targetId}"]`);
}

beforeEach(() => {
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
      general: { ...state.settings.general, language: "en" },
      interface: { ...state.settings.interface, interfaceZoom: 100 },
    },
  }));
});

describe("Interface Zoom Settings search entry", () => {
  it("is discovered by interface, UI, and natural-language queries on desktop", () => {
    for (const query of ["interface zoom", "ui zoom", "larger interface"]) {
      expect(idsFor(query), query).toContain("appearance.interfaceZoom");
    }
  });

  it("carries its Appearance/Display context", () => {
    const result = searchSettings(catalog(desktop()), "interface zoom").find(
      (candidate) => candidate.entry.entry.id === "appearance.interfaceZoom",
    );
    expect(result).toBeDefined();
    expect(result!.entry.breadcrumb).toContain("Appearance");
    expect(result!.entry.breadcrumb).toContain("Display");
  });

  it("is absent on browser/mobile availability because it is desktop-only", () => {
    const entry = SETTINGS_SEARCH_ENTRIES.find(
      (candidate) => candidate.id === "appearance.interfaceZoom",
    );
    expect(entry).toBeDefined();
    expect(isSettingsSearchEntryAvailable(entry!, desktop())).toBe(true);
    for (const platform of ["web", "android", "ios"] as const) {
      expect(
        isSettingsSearchEntryAvailable(entry!, desktop({ platform })),
        platform,
      ).toBe(false);
    }
    expect(idsFor("interface zoom", desktop({ platform: "web" }))).not.toContain(
      "appearance.interfaceZoom",
    );
    expect(idsFor("interface zoom", desktop({ platform: "android" }))).not.toContain(
      "appearance.interfaceZoom",
    );
  });

  it("is covered by the Appearance inventory row", () => {
    const row = SETTINGS_SEARCH_COVERAGE.find((candidate) => candidate.section === SettingsTab.Appearance);
    expect(row?.sources).toContain("InterfaceZoomControl.tsx");
    expect(row?.catalogPrefixes.some((prefix) => "appearance.interfaceZoom".startsWith(prefix))).toBe(
      true,
    );
  });

  it("focuses the live control on activation without changing the value", async () => {
    openSettings();
    render(createElement(ThemeProvider, null, createElement(SettingsPage)));

    await act(async () => {
      fireEvent.change(searchField(), { target: { value: "interface zoom" } });
    });
    const result = await screen.findByRole("button", {
      name: /^Interface Zoom, Appearance/,
    });
    fireEvent.click(result);

    await waitFor(() => {
      const target = arrivalTarget("appearance.interfaceZoom");
      expect(target).toHaveAttribute("data-settings-search-arrival", "true");
    });

    expect(document.activeElement).toBe(arrivalTarget("appearance.interfaceZoom"));
    expect(useSettingsStore.getState().settings.interface.interfaceZoom).toBe(100);
    expect(screen.getByRole("slider", { name: "Interface Zoom" })).toHaveValue("100");
  });

  it("uses the live platform snapshot for desktop availability", () => {
    const snapshot = createSettingsSearchAvailabilitySnapshot();
    expect(snapshot.platform).toBe("desktop");
  });
});
