/**
 * Unit tests for the shared SponsorBlock settings interpretation
 * (`src/hooks/useSponsorBlock.ts`).
 *
 * This is the contract the three players rely on: with SponsorBlock off nothing
 * is requested and nothing is skipped; with a category off, that category's
 * segments are dropped before anything acts on them.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The hook selects `state.settings.sponsorBlock`, so the mock must expose that
// exact shape — a flat `sponsorBlock` would be selected as `undefined`.
const stateRef: { settings: { sponsorBlock: unknown } } = {
  settings: { sponsorBlock: undefined },
};

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(stateRef as never),
  defaultSettings: {
    sponsorBlock: {
      enabled: true,
      autoSkip: true,
      notifications: true,
      privacyMode: false,
      cacheDuration: 48,
      categories: {
        sponsor: true,
        intro: true,
        outro: true,
        selfpromo: false,
        interaction: false,
        music_offtopic: false,
        preview: false,
      },
    },
  },
}));

import { useSponsorBlock } from "../useSponsorBlock";
import type { SponsorBlockSegment } from "../../api/sponsorblock";

function seg(category: string, uuid: string): SponsorBlockSegment {
  return {
    category: category as SponsorBlockSegment["category"],
    actionType: "skip",
    segment: [0, 10] as [number, number],
    UUID: uuid,
    locked: 0,
    votes: 0,
  };
}

function setSettings(overrides: Record<string, unknown>, categories?: Record<string, boolean>) {
  stateRef.settings.sponsorBlock = {
    enabled: true,
    autoSkip: true,
    notifications: true,
    privacyMode: false,
    cacheDuration: 48,
    categories: {
      sponsor: true,
      intro: true,
      outro: true,
      selfpromo: false,
      interaction: false,
      music_offtopic: false,
      preview: false,
      ...categories,
    },
    ...overrides,
  };
}

function render() {
  return renderHook(() => useSponsorBlock());
}

beforeEach(() => {
  setSettings({});
});

describe("useSponsorBlock — gates", () => {
  it("allows fetch and skip by default", () => {
    const { result } = render();
    expect(result.current.enabled).toBe(true);
    expect(result.current.canFetch).toBe(true);
    expect(result.current.canSkip).toBe(true);
    expect(result.current.showNotifications).toBe(true);
  });

  it("blocks both the request and the seek when disabled", () => {
    setSettings({ enabled: false });
    const { result } = render();
    expect(result.current.canFetch).toBe(false);
    expect(result.current.canSkip).toBe(false);
    expect(result.current.showNotifications).toBe(false);
  });

  it("still fetches but does not seek when autoSkip is off", () => {
    setSettings({ autoSkip: false });
    const { result } = render();
    expect(result.current.canFetch).toBe(true);
    expect(result.current.canSkip).toBe(false);
  });

  it("hides the notification while still skipping when notifications are off", () => {
    setSettings({ notifications: false });
    const { result } = render();
    expect(result.current.canSkip).toBe(true);
    expect(result.current.showNotifications).toBe(false);
  });

  it("passes the cache duration through", () => {
    setSettings({ cacheDuration: 6 });
    const { result } = render();
    expect(result.current.cacheDurationHours).toBe(6);
  });
});

describe("useSponsorBlock — category filtering", () => {
  it("lists only the enabled categories", () => {
    setSettings({}, { selfpromo: true });
    const { result } = render();
    expect(result.current.enabledCategories.sort()).toEqual(
      ["intro", "outro", "selfpromo", "sponsor"].sort()
    );
  });

  it("drops a segment whose category is off", () => {
    const { result } = render();
    const filtered = result.current.filterSegments([
      seg("sponsor", "a"),
      seg("intro", "b"),
      seg("selfpromo", "c"),
    ]);
    expect(filtered.map((s) => s.UUID)).toEqual(["a", "b"]);
  });

  it("keeps a segment whose category is on", () => {
    setSettings({}, { music_offtopic: true, preview: true });
    const { result } = render();
    const filtered = result.current.filterSegments([
      seg("music_offtopic", "x"),
      seg("preview", "y"),
      seg("interaction", "z"),
    ]);
    expect(filtered.map((s) => s.UUID)).toEqual(["x", "y"]);
  });

  it("keeps a category the service returns that the app has no toggle for", () => {
    // An unknown category from the API is not silently dropped: it is absent
    // from the settings map, so the `!== false` check lets it through rather
    // than hiding segments the user never opted out of.
    const { result } = render();
    const filtered = result.current.filterSegments([seg("brand_new", "n")]);
    expect(filtered).toHaveLength(1);
  });

  it("recomputes when a category is toggled", () => {
    const { result, rerender } = render();
    expect(result.current.enabledCategories).not.toContain("selfpromo");
    act(() => setSettings({}, { selfpromo: true }));
    rerender();
    expect(result.current.enabledCategories).toContain("selfpromo");
  });
});
