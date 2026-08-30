/**
 * Language Learning master opt-in gating (settings v11): with the feature
 * globally disabled the reader mounts NO language surface — provider, host
 * panel, banner, overlays — and the per-document preference key is not
 * written. Enabled state restores the opt-in surface and honors the
 * per-document flag; global OFF dominates per-document ON.
 */
import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "../DocumentViewerWrapper";

const languageState = vi.hoisted(() => ({
  enabled: false,
  perDocumentOn: false,
  languageModeEnabled: false,
}));

vi.mock("../DocumentViewer", () => ({
  DocumentViewer: () => <div data-testid="base-viewer" />,
}));

vi.mock("../../assistant/AssistantPanel", () => ({
  AssistantPanel: () => <div data-testid="assistant-panel" />,
  READER_MIN_WIDTH: 420,
}));

vi.mock("../../assistant/PwaAssistantButton", () => ({
  PwaAssistantButton: () => null,
}));

vi.mock("../../../hooks/useFormFactor", () => ({
  useFormFactor: () => ({ formFactor: "desktop" }),
}));

vi.mock("../../../hooks/useReadingSessionTracker", () => ({
  useReadingSessionTracker: () => undefined,
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../stores/documentStore", () => {
  const state = {
    currentDocument: null,
    documents: [{ id: "doc-1", fileType: "text", dateModified: "2026-01-01" }],
  };
  return {
    useDocumentStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
        subscribe: vi.fn(),
        setState: vi.fn(),
      },
    ),
  };
});

vi.mock("../../../stores/settingsStore", () => {
  const makeState = () => ({
    settings: {
      general: { language: "en" },
      ai: {
        maxTokens: 2000,
        model: "m",
        pwaAssistantButtonEnabled: false,
        pwaAssistantButtonSide: "right",
      },
      documents: { ocr: { autoOCR: false, autoExtractOnLoad: false } },
      languageLearning: {
        enabled: languageState.enabled,
        suggestionsEnabled: true,
        showUnavailableProviders: true,
      },
    },
  });
  let state = makeState();
  return {
    useSettingsStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
        subscribe: vi.fn(),
        setState: vi.fn(),
        __setLanguageEnabled: (enabled: boolean) => {
          languageState.enabled = enabled;
          state = makeState();
        },
      },
    ),
  };
});

// The real host panel would render its bottom bar; mock it to a probe so the
// test asserts mount/unmount, not panel internals.
vi.mock("../../language/LanguageReaderHostPanel", () => ({
  LanguageReaderHostPanel: () => <div data-testid="language-host-panel" />,
}));
vi.mock("../../language/LanguageReaderActionOverlay", () => ({
  LanguageReaderActionOverlay: () => <div data-testid="language-action-overlay" />,
}));
vi.mock("../../language/LanguageTutorHost", () => ({
  LanguageTutorHost: () => null,
}));
vi.mock("../../language/LanguagePracticeOverlay", () => ({
  LanguagePracticeOverlay: () => null,
}));
vi.mock("../../language/LanguageReadingAssistOverlay", () => ({
  LanguageReadingAssistOverlay: () => null,
}));

import { useSettingsStore } from "../../../stores/settingsStore";

const settingsMock = useSettingsStore as unknown as {
  __setLanguageEnabled: (enabled: boolean) => void;
};

describe("DocumentViewerWrapper language-learning opt-in gating", () => {
  beforeEach(() => {
    localStorage.clear();
    languageState.enabled = false;
    languageState.perDocumentOn = false;
  });

  function mount() {
    return render(<DocumentViewer documentId="doc-1" />);
  }

  it("renders NO language surface when the feature is disabled by default", () => {
    languageState.perDocumentOn = true;
    localStorage.setItem("plethora.language-mode.doc-1", "on");
    mount();

    expect(screen.queryByTestId("language-host-panel")).toBeNull();
    expect(screen.queryByTestId("language-action-overlay")).toBeNull();
    expect(screen.getByTestId("base-viewer")).toBeDefined();
  });

  it("does NOT rewrite the per-document preference while globally disabled", () => {
    localStorage.setItem("plethora.language-mode.doc-1", "on");
    mount();

    // The stored preference survives untouched for a later re-enable.
    expect(localStorage.getItem("plethora.language-mode.doc-1")).toBe("on");
  });

  it("mounts the language surface when the feature is enabled", () => {
    act(() => settingsMock.__setLanguageEnabled(true));
    mount();

    expect(screen.getByTestId("language-host-panel")).toBeDefined();
  });

  it("disappears immediately when toggled off while the reader is open", () => {
    act(() => settingsMock.__setLanguageEnabled(true));
    const { unmount } = mount();
    expect(screen.getByTestId("language-host-panel")).toBeDefined();

    act(() => settingsMock.__setLanguageEnabled(false));
    unmount();
    mount();
    expect(screen.queryByTestId("language-host-panel")).toBeNull();
  });
});
