import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ReaderTapZones } from "../ReaderTapZones";
import { saveDisplayMode, saveEinkSettings } from "../../../lib/displayMode";

describe("ReaderTapZones", () => {
  beforeEach(() => {
    localStorage.clear();
    saveDisplayMode("eink");
    saveEinkSettings({ tapZones: true });
    vi.restoreAllMocks();
  });

  it("triggers onPrevPage when left 20% of container is tapped", () => {
    const onPrevPage = vi.fn();
    const onNextPage = vi.fn();
    const onToggleChrome = vi.fn();

    const { container } = render(
      <ReaderTapZones
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onToggleChrome={onToggleChrome}
        enabled={true}
      >
        <div data-testid="reader-content">Reader Content</div>
      </ReaderTapZones>
    );

    const root = container.firstElementChild as HTMLElement;
    // Mock getBoundingClientRect
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Touch on left (x=100 out of 1000 = 10%)
    fireEvent.touchStart(root, {
      touches: [{ clientX: 100, clientY: 400 }],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [{ clientX: 100, clientY: 400 }],
    });

    expect(onPrevPage).toHaveBeenCalledTimes(1);
    expect(onNextPage).not.toHaveBeenCalled();
    expect(onToggleChrome).not.toHaveBeenCalled();
  });

  it("triggers onNextPage when right 20% of container is tapped", () => {
    const onPrevPage = vi.fn();
    const onNextPage = vi.fn();
    const onToggleChrome = vi.fn();

    const { container } = render(
      <ReaderTapZones
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onToggleChrome={onToggleChrome}
        enabled={true}
      >
        <div>Reader Content</div>
      </ReaderTapZones>
    );

    const root = container.firstElementChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Touch on right (x=900 out of 1000 = 90%)
    fireEvent.touchStart(root, {
      touches: [{ clientX: 900, clientY: 400 }],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [{ clientX: 900, clientY: 400 }],
    });

    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onToggleChrome).not.toHaveBeenCalled();
  });

  it("triggers onToggleChrome when center region is tapped", () => {
    const onPrevPage = vi.fn();
    const onNextPage = vi.fn();
    const onToggleChrome = vi.fn();

    const { container } = render(
      <ReaderTapZones
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        onToggleChrome={onToggleChrome}
        enabled={true}
      >
        <div>Reader Content</div>
      </ReaderTapZones>
    );

    const root = container.firstElementChild as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Touch in center (x=500 out of 1000 = 50%)
    fireEvent.touchStart(root, {
      touches: [{ clientX: 500, clientY: 400 }],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [{ clientX: 500, clientY: 400 }],
    });

    expect(onToggleChrome).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
  });

  it("ignores swipe/drag gestures that move more than 15px", () => {
    const onPrevPage = vi.fn();
    const onNextPage = vi.fn();

    const { container } = render(
      <ReaderTapZones
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        enabled={true}
      >
        <div>Reader Content</div>
      </ReaderTapZones>
    );

    const root = container.firstElementChild as HTMLElement;

    // Start at x=100, end at x=250 (drag)
    fireEvent.touchStart(root, {
      touches: [{ clientX: 100, clientY: 400 }],
    });
    fireEvent.touchEnd(root, {
      changedTouches: [{ clientX: 250, clientY: 400 }],
    });

    expect(onPrevPage).not.toHaveBeenCalled();
    expect(onNextPage).not.toHaveBeenCalled();
  });
});
