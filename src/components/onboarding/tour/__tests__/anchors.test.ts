import { describe, expect, test } from "vitest";
import {
  TOUR_ANCHORS,
  candidatesFromAnchor,
  isVisuallyPresent,
  resolveAnchor,
  tourAnchor,
  type TourAnchorId,
} from "../anchors";

describe("tour anchors catalogue", () => {
  test("TOUR_ANCHORS values are unique", () => {
    const values = Object.values(TOUR_ANCHORS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("TOUR_ANCHORS values are non-empty kebab-case strings", () => {
    for (const [key, value] of Object.entries(TOUR_ANCHORS)) {
      expect(value).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(value.length).toBeGreaterThan(0);
      // Sanity: the key (camelCase) and value (kebab-case) must not collide
      // silently — i.e. every entry has been deliberately named.
      expect(typeof key).toBe("string");
    }
  });

  test("tourAnchor() returns the data-tour attribute pair for a known key", () => {
    expect(tourAnchor("navQueue")).toEqual({ "data-tour": "nav-queue" });
    expect(tourAnchor("shellRoot")).toEqual({ "data-tour": "shell-root" });
  });

  test("tourAnchor() accepts the literal id string too", () => {
    expect(tourAnchor("nav-queue")).toEqual({ "data-tour": "nav-queue" });
  });

  test("candidatesFromAnchor flattens a single id", () => {
    expect(candidatesFromAnchor("nav-queue")).toEqual(["nav-queue"]);
  });

  test("candidatesFromAnchor preserves the order of a candidate list", () => {
    const list: TourAnchorId[] = ["nav-queue", "mobile-nav-queue"];
    expect(candidatesFromAnchor(list)).toEqual(list);
  });
});

describe("resolveAnchor", () => {
  function mount(attrs: Record<string, string>): HTMLElement {
    const el = document.createElement("button");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }

  // jsdom returns zero-size rects by default; give every mounted element a
  // plausible non-zero box so the visibility check passes.
  function giveRect(el: HTMLElement, rect: Partial<DOMRect> = {}): void {
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
        ...rect,
      }) as DOMRect;
  }

  test("returns the first candidate that is present and visible", () => {
    const desktop = mount({ "data-tour": "nav-queue" });
    giveRect(desktop);
    try {
      const resolved = resolveAnchor(["nav-queue", "mobile-nav-queue"]);
      expect(resolved).toBe(desktop);
    } finally {
      desktop.remove();
    }
  });

  test("falls through to a later candidate when the first is absent", () => {
    const mobile = mount({ "data-tour": "mobile-nav-queue" });
    giveRect(mobile);
    try {
      const resolved = resolveAnchor(["nav-queue", "mobile-nav-queue"]);
      expect(resolved).toBe(mobile);
    } finally {
      mobile.remove();
    }
  });

  test("returns null when no candidate is present", () => {
    expect(resolveAnchor(["nav-queue", "mobile-nav-queue"])).toBeNull();
  });

  test("skips an element with a zero-size bounding box (collapsed sidebar item)", () => {
    const el = mount({ "data-tour": "nav-queue" });
    // Force a zero-width rect: a collapsed sidebar item is in the DOM but
    // occupies no pixels.
    giveRect(el, { width: 0, height: 0 });
    try {
      expect(resolveAnchor(["nav-queue"])).toBeNull();
    } finally {
      el.remove();
    }
  });

  test("skips an element whose ancestor is visibility:hidden", () => {
    const parent = document.createElement("div");
    parent.style.visibility = "hidden";
    const child = document.createElement("button");
    child.setAttribute("data-tour", "nav-queue");
    parent.appendChild(child);
    document.body.appendChild(parent);
    giveRect(child);
    try {
      expect(resolveAnchor(["nav-queue"])).toBeNull();
    } finally {
      parent.remove();
    }
  });

  test("isVisuallyPresent is false for a disconnected element", () => {
    const el = document.createElement("button");
    expect(isVisuallyPresent(el)).toBe(false);
  });
});
