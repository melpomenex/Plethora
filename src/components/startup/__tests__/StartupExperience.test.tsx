/**
 * StartupExperience component tests (design D14 component/lifecycle layer).
 *
 * Uses fake timers with requestAnimationFrame faked through setTimeout, the
 * component's `__kpTestClock` injectable clock for deterministic virtual
 * time, a presentation mock, and the real startup-experience store.
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
  return { presentation };
});

vi.mock("../../../contexts/PresentationContext", () => ({
  usePresentation: () => mocks.presentation,
}));

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
  /** Skip the launch-claim reset (simulates the same live JS runtime). */
  reuseRuntime?: boolean;
}

interface Driver {
  advance: (ms: number) => void;
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
    reuseRuntime = false,
  } = options;

  window.location.hash = hash;
  mocks.presentation.reducedMotion = reducedMotion;
  mocks.presentation.isEinkMode = eink;
  mocks.presentation.isMobileShell = mobile;

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
    rerender: (ui: ReactElement) => view.rerender(ui),
    unmount: () => view.unmount(),
  };
}

const markReady = (): void => {
  act(() => {
    useStartupExperienceStore.getState().markRoutePainted();
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

  it("kill switch renders no startup overlay", () => {
    const d = setup({ startupAnimationEnabled: false });
    d.advance(32);
    expect(overlayRoot()).toBeNull();
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

describe("shell readiness", () => {
  it.each([{}, { reducedMotion: true }, { eink: true }])(
    "removes the overlay and releases input in the shell's ready commit",
    (options) => {
      const driver = setup(options);
      driver.advance(16);
      expect(overlayRoot()).not.toBeNull();
      expect(document.querySelector(".kp-shield")).not.toBeNull();

      markReady();

      expect(overlayRoot()).toBeNull();
      expect(document.querySelector(".kp-shield")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("holds the idle pose until the shell is ready", () => {
    const driver = setup();
    driver.advance(16);
    driver.advance(1_800);
    expect(stageOf()).toBe("idle");
    driver.advance(3_000);
    expect(stageOf()).toBe("idle");
    markReady();
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
    expect(overlayRoot()).toBeNull();
  });
});

describe("failure paths", () => {
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
