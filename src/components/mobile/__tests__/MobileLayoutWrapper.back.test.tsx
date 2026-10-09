import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../../test/utils";
import { MobileLayoutWrapper } from "../MobileLayoutWrapper";
import * as tauri from "../../../lib/tauri";
// AdaptiveAppScaffold renders ThemeBackdrop, whose useTheme() requires the
// app-root ThemeProvider (main.tsx mounts it above MainLayout/MobileLayoutWrapper).
import { ThemeProvider } from "../../../contexts/ThemeContext";
import {
  registerContextualBackHandler,
  resetContextualBackHandlersForTests,
} from "../../../lib/contextualBack";
import {
  registerOverlayDismissal,
  resetOverlayStackForTests,
} from "../../../lib/overlayStack";

const { useEdgeSwipeBackMock } = vi.hoisted(() => ({ useEdgeSwipeBackMock: vi.fn() }));

vi.mock("../../../hooks/useEdgeSwipeBack", () => ({
  useEdgeSwipeBack: useEdgeSwipeBackMock,
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => true,
}));

vi.mock("../MobileNavigation", () => ({
  MobileNavigation: () => null,
}));

vi.mock("../PWAComponents", () => ({
  PWAInstallPrompt: () => null,
  OfflineIndicator: () => null,
}));

describe("MobileLayoutWrapper back dispatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useEdgeSwipeBackMock.mockClear();
    resetContextualBackHandlersForTests();
    resetOverlayStackForTests();
  });

  it("routes native back to the contextual handler and prevents the host default", () => {
    const contextual = vi.fn(() => true);
    registerContextualBackHandler(contextual);
    render(
      <ThemeProvider>
        <MobileLayoutWrapper>
          <div>Content</div>
        </MobileLayoutWrapper>
      </ThemeProvider>,
    );

    const event = new Event("plethora:system-back", { cancelable: true });
    window.dispatchEvent(event);

    expect(contextual).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(useEdgeSwipeBackMock).toHaveBeenLastCalledWith(expect.any(Function), { disabled: false });
  });

  it("lets an overlay consume native back before Settings", () => {
    const overlay = vi.fn();
    const contextual = vi.fn(() => true);
    registerOverlayDismissal(overlay);
    registerContextualBackHandler(contextual);
    render(
      <ThemeProvider>
        <MobileLayoutWrapper>
          <div>Content</div>
        </MobileLayoutWrapper>
      </ThemeProvider>,
    );

    window.dispatchEvent(new Event("plethora:system-back", { cancelable: true }));

    expect(overlay).toHaveBeenCalledOnce();
    expect(contextual).not.toHaveBeenCalled();
  });

  it("leaves native Android Back to the platform controller", () => {
    vi.spyOn(tauri, "nativePlatform").mockReturnValue("android");
    const contextual = vi.fn(() => true);
    registerContextualBackHandler(contextual);
    render(
      <ThemeProvider>
        <MobileLayoutWrapper>
          <div>Content</div>
        </MobileLayoutWrapper>
      </ThemeProvider>,
    );

    const event = new Event("plethora:system-back", { cancelable: true });
    window.dispatchEvent(event);
    expect(contextual).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(useEdgeSwipeBackMock).toHaveBeenLastCalledWith(expect.any(Function), { disabled: true });
  });
});
