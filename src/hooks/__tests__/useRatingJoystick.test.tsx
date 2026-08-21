/**
 * Gesture-math tests for the H-pattern rating joystick.
 * These pin the zone→grade resolution, the
 * dead-zone no-commit behavior, and release-in-zone commits so the shared
 * grade-table refactor cannot silently change the touch UX.
 *
 * Zone layout (base under the thumb, DEAD_ZONE=24px, COL_HALF=48px):
 *      PASS ROW (drag up)
 *   ┌────────┬────────┬────────┐
 *   │ Hard 3 │ Good 4 │ Easy 5 │
 *   └────────┴───┬────┴────────┘
 *               ●
 *   ┌────────┬───┴────┬────────┐
 *   │ Black0 │ Wrong1 │ Almst2 │
 *   └────────┴────────┴────────┘
 *      FAIL ROW (drag down)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useRatingJoystick, JOYSTICK_GRADES } from "../useRatingJoystick";

vi.mock("../../utils/soundService", () => ({
  vibrate: vi.fn(),
}));

const BASE = { x: 200, y: 200 };

function touchEvent(type: string, x: number, y: number): TouchEvent {
  const event = new Event(type, { cancelable: true, bubbles: true }) as TouchEvent;
  Object.defineProperty(event, "touches", {
    value: [{ clientX: x, clientY: y }],
    configurable: true,
  });
  Object.defineProperty(event, "changedTouches", {
    value: [{ clientX: x, clientY: y }],
    configurable: true,
  });
  return event;
}

/** Mount harness so the hook's effect binds listeners to a real element. */
function Harness({ onSelect, enabled }: { onSelect: (rating: 1 | 2 | 3 | 4, grade: number) => void; enabled?: () => boolean }) {
  const joystick = useRatingJoystick({ onSelect, enabled });
  return (
    <div
      ref={joystick.ref}
      data-testid="target"
      data-active={joystick.activeGrade ?? ""}
      data-active-flag={joystick.isActive ? "true" : "false"}
    />
  );
}

interface ZoneCase {
  name: string;
  dx: number;
  dy: number;
  grade: number;
  rating: 1 | 2 | 3 | 4;
}

const ZONE_CASES: ZoneCase[] = [
  { name: "up-left → grade 3 (Hard, rating 2)", dx: -100, dy: -60, grade: 3, rating: 2 },
  { name: "up-center → grade 4 (Good, rating 3)", dx: 0, dy: -60, grade: 4, rating: 3 },
  { name: "up-right → grade 5 (Easy, rating 4)", dx: 100, dy: -60, grade: 5, rating: 4 },
  { name: "down-left → grade 0 (Blackout, rating 1)", dx: -100, dy: 60, grade: 0, rating: 1 },
  { name: "down-center → grade 1 (Wrong, rating 1)", dx: 0, dy: 60, grade: 1, rating: 1 },
  { name: "down-right → grade 2 (Almost, rating 1)", dx: 100, dy: 60, grade: 2, rating: 1 },
];

function setup(enabled?: () => boolean) {
  const onSelect = vi.fn();
  const utils = render(<Harness onSelect={onSelect} enabled={enabled} />);
  const el = utils.getByTestId("target");
  const active = () => el.getAttribute("data-active");
  const isActive = () => el.getAttribute("data-active-flag") === "true";
  return { onSelect, el, active, isActive };
}

describe("useRatingJoystick gesture math", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(ZONE_CASES)("%s commits on release", ({ dx, dy, grade, rating }) => {
    const { onSelect, el, active, isActive } = setup();
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
    });
    act(() => {
      el.dispatchEvent(touchEvent("touchmove", BASE.x + dx, BASE.y + dy));
    });
    expect(active()).toBe(String(grade));
    expect(isActive()).toBe(true);
    act(() => {
      el.dispatchEvent(touchEvent("touchend", BASE.x + dx, BASE.y + dy));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(rating, grade);
    expect(isActive()).toBe(false);
  });

  it("dead-zone drag selects no grade and release does not commit", () => {
    const { onSelect, el, active } = setup();
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
    });
    act(() => {
      // 10px away — inside the 24px dead-zone.
      el.dispatchEvent(touchEvent("touchmove", BASE.x + 6, BASE.y + 8));
    });
    expect(active()).toBe("");
    act(() => {
      el.dispatchEvent(touchEvent("touchend", BASE.x + 6, BASE.y + 8));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("pure tap (no move) stays in the dead-zone and cancels", () => {
    const { onSelect, el } = setup();
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
    });
    act(() => {
      el.dispatchEvent(touchEvent("touchend", BASE.x, BASE.y));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("dy === 0 on the seam resolves to the pass row", () => {
    const { onSelect, el, active } = setup();
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
    });
    act(() => {
      // Straight horizontal drag beyond COL_HALF stays on the pass row seam.
      el.dispatchEvent(touchEvent("touchmove", BASE.x + 100, BASE.y));
    });
    expect(active()).toBe("5");
    act(() => {
      el.dispatchEvent(touchEvent("touchend", BASE.x + 100, BASE.y));
    });
    expect(onSelect).toHaveBeenCalledWith(4, 5);
  });

  it("crossing zones updates the active grade before release", () => {
    const { el, active } = setup();
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
    });
    act(() => {
      el.dispatchEvent(touchEvent("touchmove", BASE.x, BASE.y - 60));
    });
    expect(active()).toBe("4");
    act(() => {
      el.dispatchEvent(touchEvent("touchmove", BASE.x + 100, BASE.y - 60));
    });
    expect(active()).toBe("5");
    act(() => {
      el.dispatchEvent(touchEvent("touchmove", BASE.x + 100, BASE.y + 60));
    });
    expect(active()).toBe("2");
  });

  it("does not start when the enabled gate returns false", () => {
    const { onSelect, el, isActive } = setup(() => false);
    act(() => {
      el.dispatchEvent(touchEvent("touchstart", BASE.x, BASE.y));
      el.dispatchEvent(touchEvent("touchmove", BASE.x + 100, BASE.y - 60));
      el.dispatchEvent(touchEvent("touchend", BASE.x + 100, BASE.y - 60));
    });
    expect(isActive()).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("joystick grade table stays in lockstep with the shared semantics", () => {
    // Every joystick entry resolves to the shared grade↔rating equivalence.
    for (const entry of JOYSTICK_GRADES) {
      const expected = entry.grade < 3 ? 1 : (entry.grade - 1) as 1 | 2 | 3 | 4;
      expect(entry.rating).toBe(expected);
    }
    // H layout: pass row 3,4,5 then fail row 0,1,2.
    expect(JOYSTICK_GRADES.map((g) => g.grade)).toEqual([3, 4, 5, 0, 1, 2]);
  });
});
