import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "../../test/utils";
import { useEdgeSwipeBack } from "../useEdgeSwipeBack";

function Harness({ onBack }: { onBack: () => void }) {
  useEdgeSwipeBack(onBack);
  return (
    <div>
      <div data-testid="neutral">Neutral</div>
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
    fireEvent.touchEnd(target, { changedTouches: [{ clientX: 84, clientY: 84 }] });

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("ignores vertical movement and protected controls", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);

    const neutral = screen.getByTestId("neutral");
    fireEvent.touchStart(neutral, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(neutral, { touches: [{ clientX: 30, clientY: 110 }] });
    fireEvent.touchEnd(neutral, { changedTouches: [{ clientX: 30, clientY: 110 }] });

    const input = screen.getByRole("textbox", { name: "Protected input" });
    fireEvent.touchStart(input, { touches: [{ clientX: 8, clientY: 20 }] });
    fireEvent.touchMove(input, { touches: [{ clientX: 90, clientY: 20 }] });
    fireEvent.touchEnd(input, { changedTouches: [{ clientX: 90, clientY: 20 }] });

    expect(onBack).not.toHaveBeenCalled();
  });
});
