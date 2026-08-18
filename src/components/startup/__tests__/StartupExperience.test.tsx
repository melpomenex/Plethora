/**
 * StartupExperience component tests (design D14 component/lifecycle layer).
 *
 * Uses fake timers with requestAnimationFrame faked through setTimeout, the
 * component's `__kpTestClock` injectable clock for deterministic virtual
 * time, module mocks for the presentation context and the startup store
 * (established vi.hoisted patterns), and the REAL startup-experience store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => {
  const presentation = {
    mode: "desktop" as string,
    platform: "mac",
    pointer: "fine" as string,
    reducedMotion: false,
    isMobileShell: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    displayMode: "standard" as string,
    isEinkMode: false,
    setDisplayMode: () => {},
  };
  return {
    presentation,
    ensureStartup: vi.fn(async () => null),
    setStartupStatus: (_status: string) => {},
  };
});

vi.mock("../../../contexts/PresentationContext", () => ({
  usePresentation: () => mocks.presentation,
}));

vi.mock("../../../stores/startupStore", async () => {
  const { create } = await import("zustand");
  const useStartupStore = create(() => ({
    status: "idle",
    error: null,
    ensureStartup: mocks.ensureStartup,
    retryStartup: vi.fn(async () => null),
  }));
  // Expose a status driver to the tests (the component subscribes to this).
  (mocks as { setStartupStatus: (s: string) => void }).setStartupStatus = (
    status: string
  ) => useStartupStore.setState({ status });
  return { useStartupStore };
});

import { StartupExperience } from "../StartupExperience";
import {
  __resetLaunchClaimForTests,
  useStartupExperienceStore,
} from "../../../lib/startupAnimation/store";
import { useSettingsStore, defaultSettings } from "../../../stores/settingsStore";

const overlayRoot = (): HTMLElement | null =>
  document.querySelector(".kp-overlay");

const stageOf = (): string | null => overlayRoot()?.getAttribute("data-kp-stage") ?? null;

interface SetupOptions {
  hash?: string;
  reducedMotion?: boolean;
  eink?: boolean;
  mobile?: boolean;
  startupAnimationEnabled?: boolean;
  initialStatus?: string;
  /** Skip the launch-claim reset (simulates the same live JS runtime). */
  reuseRuntime?: boolean;
}

interface Driver {
  advance: (ms: number) => void;
  clock: () => number;
  rerender: (ui: ReactElement) => void;
  unmount: () => void;
}

let fakeClock = 0;

function setup(options: SetupOptions = {}): Driver {
  const {
    hash = "#/",
    reducedMotion = false,
    eink = false,
    mobile = false,
    startupAnimationEnabled = true,
    initialStatus = "idle",
    reuseRuntime = false,
  } = options;

  window.location.hash = hash;
  mocks.presentation.reducedMotion = reducedMotion;
  mocks.presentation.isEinkMode = eink;
  mocks.presentation.isMobileShell = mobile;
  mocks.setStartupStatus(initialStatus);

  if (!reuseRuntime) __resetLaunchClaimForTests();
  useStartupExperienceStore.getState().reset();
  useSettingsStore.setState({
    settings: {
      ...defaultSettings,
      interface: {
        ...defaultSettings.interface,
        startupAnimationEnabled,
      },
    },
  });

  fakeClock = 1_000;
  (window as Window & { __kpTestClock?: () => number }).__kpTestClock =
    () => fakeClock;

  const view = render(<StartupExperience />);
  return {
    advance: (ms: number) => {
      fakeClock += ms;
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    },
    clock: () => fakeClock,
    rerender: (ui: ReactElement) => view.rerender(ui),
    unmount: () => view.unmount(),
  };
}

const markReady = (): void => {
  act(() => {
    useStartupExperienceStore.getState().markRoutePainted();
    mocks.setStartupStatus("ready");
  });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // jsdom rAF exists but ignores fake time — route it through fake setTimeout.
  vi.stubGlobal(
    "requestAnimationFrame",
    (cb: (t: number) => void) => setTimeout(() => cb(fakeClock), 16) as unknown as number
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  mocks.ensureStartup.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  (window as Window & { __kpTestClock?: () => number }).__kpTestClock = undefined;
  window.location.hash = "";
});

describe("arming and variant selection", () => {
  it("arms for the main route and starts the full desktop choreography", () => {
    const d = setup();
    d.advance(16);
    expect(overlayRoot()).not.toBeNull();
    expect(overlayRoot()!.getAttribute("data-variant")).toBe("full");
    expect(overlayRoot()!.getAttribute("data-form-factor")).toBe("desktop");
    expect(stageOf()).toBe("choreography");
    expect(mocks.ensureStartup).toHaveBeenCalledWith("startup");
  });

  it("phone form factor selects the 2-fragment mobile script", () => {
    const d = setup({ mobile: true });
    d.advance(16);
    const scene = document.querySelector(".kp-scene")!;
    expect(scene.getAttribute("data-form-factor")).toBe("phone");
    const fragments = document.querySelectorAll('[data-kp-part^="fragment-"]');
    expect(fragments.length).toBe(2);
    expect(document.querySelectorAll('[data-kp-part^="connector-"]').length).toBe(1);
  });

  it("kill switch renders nothing and never touches the startup snapshot", () => {
    const d = setup({ startupAnimationEnabled: false });
    d.advance(32);
    expect(overlayRoot()).toBeNull();
    expect(mocks.ensureStartup).not.toHaveBeenCalled();
  });

  it("utility routes never arm", () => {
    for (const hash of ["#/screenshot-overlay", "#/auth/callback?code=x"]) {
      const d = setup({ hash });
      d.advance(64);
      expect(overlayRoot(), `${hash} must not arm`).toBeNull();
    }
  });

  it("a second mount in the same runtime does not arm (once per runtime)", () => {
    const first = setup();
    first.advance(16);
    expect(overlayRoot()).not.toBeNull();
    first.unmount();

    const second = setup({ reuseRuntime: true });
    second.advance(64);
    expect(overlayRoot()).toBeNull();
  });
});

describe("stage progression (desktop full choreography)", () => {
  it("normal cold startup: choreography → resolve → reveal → gone", () => {
    const d = setup();
    d.advance(16);
    expect(stageOf()).toBe("choreography");

    markReady();
    d.advance(16);
    expect(stageOf()).toBe("resolve");

    // Fast start: the remaining choreography compresses into the ~900 ms
    // play budget (every peck still plays), then the 250 ms crossfade.
    d.advance(950);
    expect(stageOf()).toBe("reveal");
    expect(overlayRoot()!.getAttribute("data-fading")).toBe("true");

    d.advance(300);
    expect(overlayRoot()).toBeNull();
  });

  it("ready before the choreography begins still plays every peck, compressed", () => {
    const d = setup();
    d.advance(16);
    markReady();
    d.advance(16);
    expect(stageOf()).toBe("resolve");

    // Mid-compression: the first peck must have landed (fragment → card) —
    // the metaphor is never skipped on a fast start.
    d.advance(500);
    const fragment = document.querySelector('[data-kp-part="fragment-1"]');
    expect(fragment?.getAttribute("data-visual")).toBe("card");
    expect(stageOf()).toBe("resolve"); // still playing compressed beats

    d.advance(450);
    expect(
      stageOf() === "reveal" || overlayRoot() === null,
      `expected reveal/done ~950ms after ready, got ${stageOf()}`
    ).toBe(true);
  });
});

describe("adaptive budgets (amended: complete-metaphor playback)", () => {
  it("pointer-events released ≤ 900 ms and overlay gone ≤ 1150 ms after appReady", () => {
    const d = setup();
    d.advance(200); // mid-fragments

    const readyClock = d.clock();
    markReady();

    let revealAt: number | null = null;
    let goneAt: number | null = null;
    for (let t = 0; t <= 1400; t += 16) {
      d.advance(16);
      const root = overlayRoot();
      if (root === null) {
        goneAt = d.clock() - readyClock;
        break;
      }
      if (revealAt === null && root.getAttribute("data-kp-stage") === "reveal") {
        revealAt = d.clock() - readyClock;
      }
    }
    expect(revealAt, "reveal must start within 900 ms of readiness").not.toBeNull();
    expect(revealAt!).toBeLessThanOrEqual(950); // 900 budget + one poll frame
    expect(goneAt, "overlay must unmount within 1150 ms of readiness").not.toBeNull();
    expect(goneAt!).toBeLessThanOrEqual(1200);
  });

  it("slow startup reaches idle, holds without restarting, and resolves once ready", () => {
    const d = setup();
    d.advance(16);
    d.advance(1800); // past desktop idleAt (1520)
    expect(stageOf()).toBe("idle");
    const scene = document.querySelector(".kp-scene")!;
    expect(scene.getAttribute("data-idle")).toBe("true");

    d.advance(3000); // idle is indefinite; no re-pecking
    expect(stageOf()).toBe("idle");

    markReady();
    d.advance(16);
    expect(stageOf()).toBe("resolve");
    d.advance(600);
    expect(stageOf()).toBe("reveal");
    d.advance(300);
    expect(overlayRoot()).toBeNull();
  });
});

describe("reduced-motion variant", () => {
  it("shows the static variant and crossfades on ready (no choreography)", () => {
    const d = setup({ reducedMotion: true });
    d.advance(32);
    const root = overlayRoot()!;
    expect(root.getAttribute("data-variant")).toBe("reduced-motion");
    expect(stageOf()).not.toBe("choreography");

    markReady();
    d.advance(16);
    expect(root.getAttribute("data-fading")).toBe("true");
    d.advance(300);
    expect(overlayRoot()).toBeNull();
  });
});

describe("e-ink variant", () => {
  it("plays three crisp stepped stills and reveals without fades", () => {
    const d = setup({ eink: true });
    d.advance(16);
    const root = overlayRoot()!;
    expect(root.getAttribute("data-variant")).toBe("eink");

    d.advance(500);
    expect(document.querySelectorAll('[data-kp-part^="fragment-"]').length).toBeGreaterThan(0);
    d.advance(500); // step 3: fragments replaced by the mark + wordmark
    expect(document.querySelector(".kp-wordmark")).not.toBeNull();

    markReady();
    d.advance(500);
    expect(overlayRoot()).toBeNull();
  });
});

describe("failure paths", () => {
  it("startup error aborts into a fast fade and unmounts", () => {
    const d = setup();
    d.advance(64);
    act(() => mocks.setStartupStatus("error"));
    expect(stageOf()).toBe("aborted");
    expect(overlayRoot()!.getAttribute("data-aborting")).toBe("true");
    d.advance(200);
    expect(overlayRoot()).toBeNull();
  });

  it("watchdog force-exits at 15 s even with no signal at all", () => {
    const d = setup();
    d.advance(16);
    d.advance(14_000);
    expect(stageOf()).not.toBe("aborted");
    d.advance(1_000);
    expect(stageOf()).toBe("aborted");
    d.advance(200);
    expect(overlayRoot()).toBeNull();
  });
});

describe("cleanup", () => {
  it("unmount leaves no pending rAF or timers", () => {
    const d = setup();
    d.advance(200);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // watchdog at least

    d.unmount();
    expect(vi.getTimerCount()).toBe(0);
    // Store reset: a fresh arm in a new runtime starts from handoff.
    expect(useStartupExperienceStore.getState().stage).toBe("handoff");
  });
});
