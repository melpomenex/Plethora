import { describe, expect, test } from "vitest";
import { TOUR_ANCHORS, candidatesFromAnchor, resolveAnchor, type TourAnchorId } from "../anchors";
import { TOUR_CHAPTERS } from "../steps";
import { flattenSteps } from "../types";

/**
 * Spec: "Anchor catalogue is authoritative" + "Adaptive and resilient anchor
 * resolution". These tests assert the contract between step definitions and
 * the anchor catalogue:
 *
 * - Every anchor referenced by any step exists in `TOUR_ANCHORS`.
 * - A step declaring `[desktop, mobile]` candidates resolves to whichever
 *   is rendered on the current viewport.
 * - An optional step with no resolvable candidate degrades to a centred
 *   card (anchor candidates return null).
 * - A `requiresAnchor: true` step with no resolvable candidate would be
 *   excluded from the displayed total — verified at the engine level in
 *   useOnboardingTour.test.ts.
 */

const allSteps = flattenSteps(TOUR_CHAPTERS);
const catalogueValues = new Set<string>(Object.values(TOUR_ANCHORS));

describe("tour step ↔ anchor catalogue contract", () => {
  test("every anchor referenced by a step exists in TOUR_ANCHORS", () => {
    const violations: string[] = [];
    for (const step of allSteps) {
      if (!step.anchor) continue;
      const candidates = candidatesFromAnchor(step.anchor);
      for (const id of candidates) {
        if (!catalogueValues.has(id)) {
          violations.push(`${step.id} references unknown anchor "${id}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("catalogue values are unique", () => {
    const values = Object.values(TOUR_ANCHORS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("every chapter has at least one step", () => {
    for (const chapter of TOUR_CHAPTERS) {
      expect(chapter.steps.length).toBeGreaterThan(0);
    }
  });

  test("every step has a stable id unique across the whole tour", () => {
    const ids = allSteps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the seven chapters cover the spec's required surfaces", () => {
    const labels = TOUR_CHAPTERS.map((c) => c.id);
    expect(labels).toEqual([
      "welcome",
      "bring-in",
      "read-extract",
      "queue",
      "review",
      "knowledge",
      "make-yours",
    ]);
  });

  test("reader-chapter steps are requiresAnchor:false so they degrade to centred cards", () => {
    const readerSteps = TOUR_CHAPTERS.find((c) => c.id === "read-extract")!.steps;
    for (const step of readerSteps) {
      expect(step.requiresAnchor ?? false).toBe(false);
    }
  });
});

describe("adaptive anchor resolution", () => {
  function mount(attrs: Record<string, string>): HTMLElement {
    const el = document.createElement("button");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.style.width = "100px";
    el.style.height = "40px";
    el.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        right: 100,
        bottom: 40,
        left: 0,
        width: 100,
        height: 40,
        toJSON: () => {},
      }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }

  test("queue-nav step resolves to the mobile candidate when only mobile nav is rendered", () => {
    const queueStep = allSteps.find((s) => s.id === "queue-nav")!;
    const candidates = candidatesFromAnchor(queueStep.anchor as TourAnchorId | TourAnchorId[]);
    // Only the mobile candidate is in the DOM.
    const mobile = mount({ "data-tour": TOUR_ANCHORS.mobileNavQueue });
    try {
      const resolved = resolveAnchor(candidates);
      expect(resolved).toBe(mobile);
    } finally {
      mobile.remove();
    }
  });

  test("queue-nav step resolves to the desktop candidate when both are rendered", () => {
    const queueStep = allSteps.find((s) => s.id === "queue-nav")!;
    const candidates = candidatesFromAnchor(queueStep.anchor as TourAnchorId | TourAnchorId[]);
    const desktop = mount({ "data-tour": TOUR_ANCHORS.navQueue });
    const mobile = mount({ "data-tour": TOUR_ANCHORS.mobileNavQueue });
    try {
      const resolved = resolveAnchor(candidates);
      // First-present-and-visible wins, and the desktop candidate is listed
      // first in the step definition.
      expect(resolved).toBe(desktop);
    } finally {
      desktop.remove();
      mobile.remove();
    }
  });

  test("an optional step with no resolvable candidate returns null (centred-card fallback)", () => {
    // No anchor mounted at all.
    const welcomeStep = allSteps.find((s) => s.id === "welcome-orientation")!;
    expect(welcomeStep.anchor).toBeUndefined();
    // The engine treats absent-anchor steps as centred cards; resolveAnchor
    // on an empty candidate list returns null.
    expect(resolveAnchor([])).toBeNull();
  });
});
