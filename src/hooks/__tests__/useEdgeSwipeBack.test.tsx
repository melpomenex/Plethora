import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../test/utils";
import { useEdgeSwipeBack } from "../useEdgeSwipeBack";

function Harness({ onBack }: { onBack: () => void }) {
  useEdgeSwipeBack(onBack);
  return (
    <div>
      <div data-testid="neutral">Neutral</div>
      <div className="swipeable-item" data-testid="swipeable">Swipeable</div>
      <input aria-label="Protected input" />
    </div>
  );
}

describe("useEdgeSwipeBack", () => {
  it("recognizes one qualifying left-edge swipe", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const target = screen.getByTestId("neutral");

    fireEvent.touchStart(target, { touches: [{ clientX: 8, clientY: 80 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 84, clientY: 84 }] });
    fireEvent.touchEnd(target, {
      touches: [],
      changedTouches: [{ clientX: 84, clientY: 84 }],
    });

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does not claim a horizontal swipe that starts away from the edge", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const target = screen.getByTestId("neutral");

    fireEvent.touchStart(target, { touches: [{ clientX: 120, clientY: 80 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 12, clientY: 84 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 190, clientY: 84 }] });
    fireEvent.touchEnd(target, {
      touches: [],
      changedTouches: [{ clientX: 190, clientY: 84 }],
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it("ignores vertical, outward, and short movements", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);

    const neutral = screen.getByTestId("neutral");
    fireEvent.touchStart(neutral, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(neutral, { touches: [{ clientX: 30, clientY: 110 }] });
    fireEvent.touchEnd(neutral, {
      touches: [],
      changedTouches: [{ clientX: 30, clientY: 110 }],
    });

    fireEvent.touchStart(neutral, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(neutral, { touches: [{ clientX: -12, clientY: 20 }] });
    fireEvent.touchEnd(neutral, {
      touches: [],
      changedTouches: [{ clientX: -12, clientY: 20 }],
    });

    fireEvent.touchStart(neutral, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(neutral, { touches: [{ clientX: 50, clientY: 20 }] });
    fireEvent.touchEnd(neutral, {
      touches: [],
      changedTouches: [{ clientX: 50, clientY: 20 }],
    });

    const input = screen.getByRole("textbox", { name: "Protected input" });
    fireEvent.touchStart(input, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(input, { touches: [{ clientX: 90, clientY: 20 }] });
    fireEvent.touchEnd(input, {
      touches: [],
      changedTouches: [{ clientX: 90, clientY: 20 }],
    });

    const swipeable = screen.getByTestId("swipeable");
    fireEvent.touchStart(swipeable, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(swipeable, { touches: [{ clientX: 90, clientY: 20 }] });
    fireEvent.touchEnd(swipeable, {
      touches: [],
      changedTouches: [{ clientX: 90, clientY: 20 }],
    });

    expect(onBack).not.toHaveBeenCalled();
  });

  it("abandons multi-touch and cancelled sequences", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    const target = screen.getByTestId("neutral");

    fireEvent.touchStart(target, { touches: [{ clientX: 8, clientY: 80 }] });
    fireEvent.touchMove(target, {
      touches: [
        { clientX: 84, clientY: 80 },
        { clientX: 84, clientY: 100 },
      ],
    });
    fireEvent.touchEnd(target, {
      touches: [],
      changedTouches: [{ clientX: 84, clientY: 80 }],
    });

    fireEvent.touchStart(target, { touches: [{ clientX: 8, clientY: 80 }] });
    fireEvent.touchMove(target, { touches: [{ clientX: 84, clientY: 80 }] });
    fireEvent.touchCancel(target, {
      touches: [],
      changedTouches: [{ clientX: 84, clientY: 80 }],
    });

    expect(onBack).not.toHaveBeenCalled();
  });
});
