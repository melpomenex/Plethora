/**
 * Startup-experience store unit tests: once-per-runtime guard, route gating,
 * appReady conjunction semantics, and force-exit.
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

describe("appReady conjunction semantics (design D2)", () => {
  it("appReady is true only when dataReady AND routePainted", () => {
    const s = useStartupExperienceStore.getState();
    expect(s.appReady).toBe(false);

    s.markDataReady();
    expect(useStartupExperienceStore.getState().dataReady).toBe(true);
    expect(useStartupExperienceStore.getState().appReady).toBe(false);

    useStartupExperienceStore.getState().markRoutePainted();
    expect(useStartupExperienceStore.getState().routePainted).toBe(true);
    expect(useStartupExperienceStore.getState().appReady).toBe(true);
  });

  it("routePainted alone is not readiness", () => {
    useStartupExperienceStore.getState().markRoutePainted();
    expect(useStartupExperienceStore.getState().appReady).toBe(false);
  });
});

describe("error exit and force exit", () => {
  it("markDataError aborts immediately (errors are never concealed)", () => {
    useStartupExperienceStore.getState().markDataError();
    expect(useStartupExperienceStore.getState().stage).toBe("aborted");
    expect(useStartupExperienceStore.getState().appReady).toBe(false);
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
    useStartupExperienceStore.getState().markDataReady();
    useStartupExperienceStore.getState().setStage("reveal");
    useStartupExperienceStore.getState().reset();
    const s = useStartupExperienceStore.getState();
    expect(s.stage).toBe("handoff");
    expect(s.dataReady).toBe(false);
    expect(s.appReady).toBe(false);
    expect(claimLaunch()).toBe(false); // still spent this runtime
  });
});
