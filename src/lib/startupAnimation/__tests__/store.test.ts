/**
 * Startup-experience store unit tests: once-per-runtime guard, route gating,
 * shell readiness and force-exit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLaunchClaimForTests,
  claimLaunch,
  shouldArmForRoute,
  useStartupExperienceStore,
} from "../store";

beforeEach(() => {
  __resetLaunchClaimForTests();
  useStartupExperienceStore.getState().reset();
});

describe("once-per-runtime guard", () => {
  it("the first claim wins; a second claim in the same runtime is refused", () => {
    expect(claimLaunch()).toBe(true);
    expect(claimLaunch()).toBe(false);
    expect(claimLaunch()).toBe(false);
  });
});

describe("route gating", () => {
  it("arms for the main window (catch-all) hashes, including deep links", () => {
    expect(shouldArmForRoute("")).toBe(true);
    expect(shouldArmForRoute("#/")).toBe(true);
    expect(shouldArmForRoute("#/documents/42")).toBe(true);
    expect(shouldArmForRoute("#/?shared_url=https%3A%2F%2Fexample.com")).toBe(true);
  });

  it("never arms for utility routes", () => {
    expect(shouldArmForRoute("#/screenshot-overlay")).toBe(false);
    expect(shouldArmForRoute("#/screenshot-overlay?theme=dark")).toBe(false);
    expect(shouldArmForRoute("#/auth/callback")).toBe(false);
    expect(shouldArmForRoute("#/auth/callback?code=x&state=y")).toBe(false);
  });
});

describe("shell readiness and force exit", () => {
  it("ends the startup presentation when the shell is ready", () => {
    const state = useStartupExperienceStore.getState();
    state.setStage("choreography");
    state.markRoutePainted();
    expect(useStartupExperienceStore.getState()).toMatchObject({ routePainted: true, stage: "done" });
  });

  it("forceExit aborts from any stage", () => {
    useStartupExperienceStore.getState().setStage("choreography");
    useStartupExperienceStore.getState().forceExit();
    expect(useStartupExperienceStore.getState().stage).toBe("aborted");
  });
});

describe("reset (unmount cleanup)", () => {
  it("restores pristine flags but does not refund the launch claim", () => {
    claimLaunch();
    useStartupExperienceStore.getState().markRoutePainted();
    useStartupExperienceStore.getState().reset();
    const s = useStartupExperienceStore.getState();
    expect(s.stage).toBe("handoff");
    expect(s.routePainted).toBe(false);
    expect(claimLaunch()).toBe(false); // still spent this runtime
  });
});
