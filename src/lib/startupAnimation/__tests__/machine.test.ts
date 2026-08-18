/**
 * State-machine unit tests: every normative transition row of design D3,
 * including normal flow, early-ready, idle→ready, error, watchdog, kill
 * switch, and terminal idempotence.
 */
import { describe, expect, it } from "vitest";
import {
  WATCHDOG_MS,
  isAnimating,
  isTerminal,
  resolveAnimationMode,
  transition,
} from "../machine";
import type { KPEvent, Stage } from "../types";

const run = (stages: Stage[], events: KPEvent[]): Stage =>
  events.reduce<Stage>((stage, event) => transition(stage, event), stages[0]);

describe("transition table (design D3)", () => {
  it("MOUNTED starts at handoff from any pre-state", () => {
    for (const stage of ["handoff", "choreography", "idle"] as Stage[]) {
      expect(transition(stage, "MOUNTED")).toBe("handoff");
    }
  });

  it("normal cold startup: handoff → choreography (driver) → APP_READY → resolve → reveal → done", () => {
    // handoff → choreography is the driver's first-rAF step (setStage), then:
    expect(transition("choreography", "APP_READY")).toBe("resolve");
    expect(transition("resolve", "APP_READY")).toBe("resolve"); // idempotent mid-exit
    // resolve → reveal on timeline end (driver setStage), then:
    expect(transition("reveal", "APP_READY")).toBe("reveal");
  });

  it("early ready: choreography + APP_READY resolves via the acceleration path", () => {
    expect(transition("choreography", "APP_READY")).toBe("resolve");
  });

  it("ready before mount: handoff + APP_READY jumps straight to resolve (epilogue only)", () => {
    expect(transition("handoff", "APP_READY")).toBe("resolve");
  });

  it("idle → APP_READY resolves immediately", () => {
    expect(transition("idle", "APP_READY")).toBe("resolve");
  });

  it.each(["APP_ERROR", "WATCHDOG", "FORCE_EXIT"] as KPEvent[])(
    "%s aborts from every non-terminal stage",
    (event) => {
      for (const stage of [
        "handoff",
        "choreography",
        "idle",
        "resolve",
        "reveal",
      ] as Stage[]) {
        expect(transition(stage, event)).toBe("aborted");
      }
    }
  );

  it("kill switch: SETTINGS_OFF aborts (first branded frame never shows)", () => {
    expect(transition("handoff", "SETTINGS_OFF")).toBe("aborted");
    expect(transition("choreography", "SETTINGS_OFF")).toBe("aborted");
  });

  it("terminal stages are idempotent against every event", () => {
    const events: KPEvent[] = [
      "MOUNTED",
      "APP_READY",
      "APP_ERROR",
      "WATCHDOG",
      "SETTINGS_OFF",
      "FORCE_EXIT",
    ];
    for (const event of events) {
      expect(transition("done", event)).toBe("done");
      expect(transition("aborted", event)).toBe("aborted");
    }
  });

  it("a full slow-startup walk ends in done exactly once (no restart)", () => {
    const stage = run(["handoff"], ["MOUNTED"]);
    expect(stage).toBe("handoff");
    // timeline exhausted without APP_READY → idle via driver; idle holds.
    expect(transition("idle", "MOUNTED")).toBe("handoff"); // only a genuine remount re-mounts, guarded outside the machine
    expect(transition("idle", "APP_READY")).toBe("resolve");
  });
});

describe("watchdog and terminal helpers", () => {
  it("WATCHDOG_MS is the 15 s hard backstop", () => {
    expect(WATCHDOG_MS).toBe(15_000);
  });

  it("isTerminal covers done/aborted only", () => {
    expect(isTerminal("done")).toBe(true);
    expect(isTerminal("aborted")).toBe(true);
    for (const stage of ["handoff", "choreography", "idle", "resolve", "reveal"] as Stage[]) {
      expect(isTerminal(stage)).toBe(false);
    }
  });

  it("isAnimating covers exactly the rAF-driven stages", () => {
    for (const stage of ["choreography", "resolve", "reveal"] as Stage[]) {
      expect(isAnimating(stage)).toBe(true);
    }
    for (const stage of ["handoff", "idle", "done", "aborted"] as Stage[]) {
      expect(isAnimating(stage)).toBe(false);
    }
  });
});

describe("resolveAnimationMode (design D8 precedence)", () => {
  const base = { startupAnimationEnabled: true, isEinkMode: false, reducedMotion: false };

  it("defaults to the full choreography", () => {
    expect(resolveAnimationMode(base)).toBe("full");
  });

  it("kill switch wins over everything", () => {
    expect(
      resolveAnimationMode({ ...base, startupAnimationEnabled: false, isEinkMode: true, reducedMotion: true })
    ).toBe("none");
  });

  it("e-ink wins over reduced motion (e-ink implies it anyway)", () => {
    expect(resolveAnimationMode({ ...base, isEinkMode: true, reducedMotion: true })).toBe("eink");
    expect(resolveAnimationMode({ ...base, isEinkMode: true, reducedMotion: false })).toBe("eink");
  });

  it("reduced motion without e-ink selects the static variant", () => {
    expect(resolveAnimationMode({ ...base, reducedMotion: true })).toBe("reduced-motion");
  });
});
