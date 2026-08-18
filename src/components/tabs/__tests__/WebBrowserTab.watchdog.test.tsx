import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  resolveWebProxyUrl: vi.fn(),
  invokeCommand: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  invokeCommand: mocks.invokeCommand,
  listen: vi.fn().mockResolvedValue(vi.fn()),
  openExternal: vi.fn(),
  openFilePicker: vi.fn(),
}));

vi.mock("../../../lib/webProxy", () => ({
  resolveWebProxyUrl: mocks.resolveWebProxyUrl,
  proxyOriginOf: vi.fn(() => "http://127.0.0.1:39471"),
  requestFrameText: vi.fn(),
  isTrustedBridgeEvent: vi.fn(() => false),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("../../assistant/AssistantPanel", () => ({
  AssistantPanel: () => <div data-testid="assistant" />,
}));

vi.mock("../../../api/extracts", () => ({ createExtract: vi.fn() }));
vi.mock("../../../api/learning-items", () => ({ createLearningItem: vi.fn() }));
vi.mock("../../../api/documents", () => ({
  createDocument: vi.fn(),
  fetchUrlContent: vi.fn(),
  readDocumentFile: vi.fn(),
}));
vi.mock("../../../utils/documentImport", () => ({ processHtmlContent: vi.fn() }));
vi.mock("../../common/KeyboardShortcuts", () => ({
  getShortcutCombo: () => "mod+e",
  useShortcutStore: { getState: () => ({ shortcuts: {} }), subscribe: () => () => {} },
}));
vi.mock("../../common/CompactTagEditor", () => ({
  CompactTagEditor: () => null,
}));

import { WebBrowserTab } from "../WebBrowserTab";

describe("WebBrowserTab Tauri navigation watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.resolveWebProxyUrl.mockResolvedValue(
      "http://127.0.0.1:39471/proxy?u=aHR0cHM6Ly9leGFtcGxlLmNvbQ=="
    );
    mocks.invokeCommand.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("surfaces the blocked fallback when no bridge ready arrives within the timeout", async () => {
    // Capture setTimeout callbacks instead of using fake timers: the tab's
    // effects also dynamically import modules whose retry machinery awaits
    // timers, which deadlocks act() under vitest's fake timers.
    const timers: Array<() => void> = [];
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(
        ((cb: () => void) => {
          timers.push(cb);
          return 0;
        }) as unknown as typeof window.setTimeout
      );

    try {
      render(<WebBrowserTab initialUrl="https://example.com" />);

      // The proxied frame is requested and the watchdog is armed… (the mocked
      // setTimeout breaks waitFor's own timer machinery, so assert directly:
      // handleNavigate ran during render's act flush).
      expect(mocks.resolveWebProxyUrl).toHaveBeenCalledWith("https://example.com");
      // Flush the proxy-resolution promise chain.
      await act(async () => {});
      // …but no trusted bridge `ready` ever arrives (escaped/off-proxy frame).

      // Fire every armed timeout — the watchdog included — deterministically.
      act(() => {
        for (const fire of timers.splice(0)) fire();
      });

      // The blocked state replaces the silent blank frame with the existing
      // recovery affordances.
      expect(screen.getByText("browser.embedBlockedTitle")).toBeInTheDocument();
      expect(screen.getByText("browser.readerView")).toBeInTheDocument();
      expect(screen.getByText("browser.openInSystemBrowser")).toBeInTheDocument();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
