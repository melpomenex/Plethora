import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "../../../test/utils";
import { EinkSettingsPanel } from "../EinkSettingsPanel";

const platformState = vi.hoisted(() => ({
  platform: "desktop" as "desktop" | "android" | "ios" | "web",
}));

vi.mock("../../../lib/platformCapabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/platformCapabilities")>()),
  resolveCurrentAppPlatform: () => platformState.platform,
}));

vi.mock("../../../contexts/PresentationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../contexts/PresentationContext")>()),
  usePresentation: () => ({
    displayMode: "standard",
    setDisplayMode: vi.fn(),
    isEinkMode: false,
  }),
}));

describe("EinkSettingsPanel", () => {
  beforeEach(() => {
    platformState.platform = "desktop";
  });

  it("hides mobile-only Reader Optimizations on desktop while keeping Display Mode", () => {
    render(<EinkSettingsPanel />);

    expect(screen.getByText("Display Mode")).toBeInTheDocument();
    expect(screen.queryByText("Reader Optimizations")).not.toBeInTheDocument();
    expect(screen.queryByText("Prefer Paginated Reading")).not.toBeInTheDocument();
    expect(screen.queryByText("One-Handed Tap Zones")).not.toBeInTheDocument();
    expect(screen.queryByText("Volume Buttons Turn Pages")).not.toBeInTheDocument();
    expect(screen.queryByText("Invert Volume Buttons")).not.toBeInTheDocument();
    expect(screen.queryByText("Grayscale Images")).not.toBeInTheDocument();
  });

  it("shows mobile-only Reader Optimizations on Android and iOS", () => {
    for (const mobilePlatform of ["android", "ios"] as const) {
      platformState.platform = mobilePlatform;
      const { unmount } = render(<EinkSettingsPanel />);

      expect(screen.getByText("Display Mode")).toBeInTheDocument();
      expect(screen.getByText("Reader Optimizations")).toBeInTheDocument();
      expect(screen.getByText("Prefer Paginated Reading")).toBeInTheDocument();
      expect(screen.getByText("One-Handed Tap Zones")).toBeInTheDocument();
      expect(screen.getByText("Volume Buttons Turn Pages")).toBeInTheDocument();
      expect(screen.getByText("Invert Volume Buttons")).toBeInTheDocument();
      expect(screen.getByText("Grayscale Images")).toBeInTheDocument();
      unmount();
    }
  });
});
