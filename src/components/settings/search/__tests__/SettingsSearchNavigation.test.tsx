import { act, render, screen, waitFor } from "../../../../test/utils";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
  SettingsSearchNavigationProvider,
  SettingsSearchTarget,
  useSettingsSearchNavigation,
  type SettingsSearchNavigationRequest,
} from "../SettingsSearchNavigation";

function Probe() {
  const { phase, missingLabel, retry, arrivalTargetId } = useSettingsSearchNavigation();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="missing">{missingLabel ?? ""}</span>
      <span data-testid="arrival">{arrivalTargetId ?? ""}</span>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  );
}

function request(overrides: Partial<SettingsSearchNavigationRequest> = {}): SettingsSearchNavigationRequest {
  return {
    id: 1,
    entryId: "test.entry",
    targetId: "test.target",
    label: "Test target",
    section: "general",
    ...overrides,
  };
}

function Harness({ initial }: { initial: SettingsSearchNavigationRequest | null }) {
  const [current, setCurrent] = useState(initial);
  return (
    <SettingsSearchNavigationProvider request={current} activeSection="general">
      <Probe />
      <button type="button" onClick={() => setCurrent(request({ id: 2, targetId: "second.target" }))}>
        Second
      </button>
      <div data-settings-search-scroller>
        <SettingsSearchTarget id="test.target" label="Test target">
          <span>Target content</span>
        </SettingsSearchTarget>
        <SettingsSearchTarget id="second.target" label="Second target">
          <span>Second content</span>
        </SettingsSearchTarget>
      </div>
    </SettingsSearchNavigationProvider>
  );
}

describe("Settings search target navigation", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
  });

  it("scrolls to, marks, and focuses a registered target", async () => {
    render(<Harness initial={request()} />);

    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("arrived"));
    const target = document.querySelector('[data-settings-search-target="test.target"]') as HTMLElement;
    expect(target).toHaveAttribute("data-settings-search-arrival", "true");
    expect(target).toHaveAttribute("tabindex", "-1");
    expect(target).toHaveTextContent("Search match");
    expect(document.activeElement).toBe(target);
    expect(screen.getByTestId("arrival")).toHaveTextContent("test.target");
  });

  it("reports a bounded missing-target failure and can retry", async () => {
    vi.useFakeTimers();
    function MissingHarness() {
      const [showTarget, setShowTarget] = useState(false);
      return (
        <SettingsSearchNavigationProvider request={request({ targetId: "late.target" })} activeSection="general">
          <Probe />
          <button type="button" onClick={() => setShowTarget(true)}>Mount target</button>
          {showTarget && (
            <SettingsSearchTarget id="late.target" label="Late target">
              <span>Late</span>
            </SettingsSearchTarget>
          )}
        </SettingsSearchNavigationProvider>
      );
    }
    render(<MissingHarness />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("missing");
    expect(screen.getByTestId("missing")).toHaveTextContent("Test target");

    act(() => {
      screen.getByRole("button", { name: "Mount target" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "Retry" }).click();
      await Promise.resolve();
    });
    expect(screen.getByTestId("phase")).toHaveTextContent("arrived");
  });

  it("uses instant scrolling when reduced motion is requested", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    window.matchMedia = vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    render(<Harness initial={request()} />);
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("arrived"));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("does not let a superseded request alter focus or arrival", async () => {    let resolveReveal: (() => void) | undefined;
    function SupersedeHarness() {
      const [current, setCurrent] = useState<SettingsSearchNavigationRequest | null>(
        request({ id: 1, targetId: "never.target", revealTargetId: "reveal.target" }),
      );
      return (
        <SettingsSearchNavigationProvider request={current} activeSection="general">
          <Probe />
          <button
            type="button"
            onClick={() => setCurrent(request({ id: 2, targetId: "test.target" }))}
          >
            Second
          </button>
          <SettingsSearchTarget
            id="reveal.target"
            reveal={() => new Promise<void>((resolve) => { resolveReveal = resolve; })}
          />
          <SettingsSearchTarget id="test.target" label="Test target">
            <span>Target</span>
          </SettingsSearchTarget>
        </SettingsSearchNavigationProvider>
      );
    }
    render(<SupersedeHarness />);
    act(() => {
      screen.getByRole("button", { name: "Second" }).click();
    });
    await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("arrived"));
    const target = document.querySelector('[data-settings-search-target="test.target"]') as HTMLElement;
    expect(document.activeElement).toBe(target);

    act(() => resolveReveal?.());
    expect(document.activeElement).toBe(target);
    expect(document.querySelector('[data-settings-search-target="never.target"]')).toBeNull();
  });
});
