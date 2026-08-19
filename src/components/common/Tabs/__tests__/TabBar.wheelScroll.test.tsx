/**
 * Tab strip wheel/trackpad scrolling (#6).
 *
 * The strip translates vertical wheel deltas into horizontal scrolling while
 * the pointer hovers it, handles native horizontal trackpad deltas and
 * Shift+wheel (which arrive as `deltaX`), never activates a tab, and only
 * blocks page scroll while it still has overflow in the gesture direction
 * (releasing at boundaries).
 */
import { render, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TabBar,
  canScrollInDirection,
  hasHorizontalOverflow,
  wheelToHorizontalDelta,
} from "../TabBar";
import type { Tab } from "../../../../stores";

vi.mock("../../../../stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    () => ({ settings: { general: { language: "en" } } }),
    {
      getState: () => ({ settings: { general: { language: "en" } } }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

const noop = () => {};

function makeTab(id: string): Tab {
  return {
    id,
    title: id,
    icon: null,
    type: "dashboard",
    content: () => <div>{id}</div>,
    closable: true,
  };
}

function renderStrip(overrides: { onTabClick?: (id: string) => void } = {}) {
  const tabs = Array.from({ length: 20 }, (_, i) => makeTab(`tab-${i}`));
  const utils = render(
    <TabBar
      tabs={tabs}
      activeTabId="tab-0"
      onTabClick={overrides.onTabClick ?? noop}
      onTabClose={noop}
    />
  );
  const strip = utils.container.querySelector(".scrollbar-hide") as HTMLElement;
  return { ...utils, strip };
}

function stubLayout(strip: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft: number) {
  Object.defineProperty(strip, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(strip, "clientWidth", { value: clientWidth, configurable: true });
  Object.defineProperty(strip, "scrollLeft", { value: scrollLeft, writable: true, configurable: true });
}

describe("wheelToHorizontalDelta", () => {
  it("prefers deltaX (native horizontal trackpad / Shift+wheel)", () => {
    expect(wheelToHorizontalDelta(30, 0)).toBe(30);
    expect(wheelToHorizontalDelta(-25, 12)).toBe(-25);
  });

  it("falls back to deltaY for a conventional vertical wheel", () => {
    expect(wheelToHorizontalDelta(0, 120)).toBe(120);
    expect(wheelToHorizontalDelta(0, -40)).toBe(-40);
  });

  it("returns 0 when there is no scroll component", () => {
    expect(wheelToHorizontalDelta(0, 0)).toBe(0);
  });
});

describe("hasHorizontalOverflow / canScrollInDirection", () => {
  it("reports overflow only when content exceeds the viewport", () => {
    const el = { scrollWidth: 1000, clientWidth: 200, scrollLeft: 0 } as HTMLElement;
    expect(hasHorizontalOverflow(el)).toBe(true);
    expect(canScrollInDirection(el, 120)).toBe(true);
    const small = { scrollWidth: 100, clientWidth: 200, scrollLeft: 0 } as HTMLElement;
    expect(hasHorizontalOverflow(small)).toBe(false);
    expect(canScrollInDirection(small, 120)).toBe(false);
  });

  it("releases at the left boundary (no more overflow in that direction)", () => {
    const el = { scrollWidth: 1000, clientWidth: 200, scrollLeft: 0 } as HTMLElement;
    expect(canScrollInDirection(el, -120)).toBe(false);
  });

  it("releases at the right boundary", () => {
    const el = { scrollWidth: 1000, clientWidth: 200, scrollLeft: 800 } as HTMLElement;
    expect(canScrollInDirection(el, 120)).toBe(false);
  });
});

describe("TabBar wheel scrolling", () => {
  let scrollBy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom has no Element.scrollBy; spy it so we can assert strip scrolling.
    scrollBy = vi.fn();
    Element.prototype.scrollBy = scrollBy as never;
  });

  it("translates a vertical wheel into horizontal strip scrolling", () => {
    const { strip } = renderStrip();
    fireEvent.wheel(strip, { deltaY: 120 });
    expect(scrollBy).toHaveBeenCalledWith({ left: 120, behavior: "auto" });
    fireEvent.wheel(strip, { deltaY: -40 });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -40, behavior: "auto" });
  });

  it("scrolls horizontally on native trackpad / Shift+wheel deltaX", () => {
    const { strip } = renderStrip();
    fireEvent.wheel(strip, { deltaX: 60, deltaY: 0 });
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: "auto" });
    fireEvent.wheel(strip, { deltaX: -90, deltaY: 0 });
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -90, behavior: "auto" });
  });

  it("handles small momentum/inertial deltas as a smooth sequence", () => {
    const { strip } = renderStrip();
    for (const d of [1.5, 2, 3, 2.5, 1]) {
      fireEvent.wheel(strip, { deltaX: d, deltaY: 0 });
    }
    expect(scrollBy).toHaveBeenCalledTimes(5);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 1, behavior: "auto" });
  });

  it("never changes the active tab from a wheel gesture", () => {
    const onTabClick = vi.fn();
    const { strip } = renderStrip({ onTabClick });
    fireEvent.wheel(strip, { deltaY: 120 });
    fireEvent.wheel(strip, { deltaX: 60, deltaY: 0 });
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it("only scrolls the strip container, never the content pane", () => {
    const { strip } = renderStrip();
    fireEvent.wheel(strip, { deltaY: 120 });
    for (const call of scrollBy.mock.calls) {
      // Every scroll targets the strip horizontally; there is no vertical
      // content scroll anywhere.
      expect(call[0]).toEqual(expect.objectContaining({ left: expect.any(Number) }));
      expect(call[0].top).toBeUndefined();
    }
  });

  it("blocks page scroll only while overflow remains in the gesture direction", () => {
    const { strip } = renderStrip();
    stubLayout(strip, 1000, 200, 0);

    // Hovering an overflowed strip at the left: a rightward gesture is consumed.
    const consumed = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    strip.dispatchEvent(consumed);
    expect(consumed.defaultPrevented).toBe(true);

    // At the right boundary the same gesture is released to the page.
    strip.scrollLeft = 800;
    const released = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    strip.dispatchEvent(released);
    expect(released.defaultPrevented).toBe(false);
  });

  it("releases to the page at the left boundary too", () => {
    const { strip } = renderStrip();
    stubLayout(strip, 1000, 200, 0);

    const atLeftBoundary = new WheelEvent("wheel", { deltaY: -120, bubbles: true, cancelable: true });
    strip.dispatchEvent(atLeftBoundary);
    expect(atLeftBoundary.defaultPrevented).toBe(false);
  });

  it("does not trap page scroll when the strip has no overflow at all", () => {
    const tabs = [makeTab("a"), makeTab("b")];
    const { container } = render(
      <TabBar tabs={tabs} activeTabId="a" onTabClick={noop} onTabClose={noop} />
    );
    const strip = container.querySelector(".scrollbar-hide") as HTMLElement;
    stubLayout(strip, 100, 200, 0);

    const evt = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
    strip.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});
