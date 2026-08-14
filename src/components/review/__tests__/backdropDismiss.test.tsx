import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useBackdropDismiss } from "../FlashcardStudioModal";

/**
 * Regression guard for the Android soft-keyboard dismiss bug: tapping the
 * composer opened the keyboard, the layout reflowed, and the resulting click
 * resolved on the backdrop — closing the studio the instant you tried to type.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const backdropDismiss = useBackdropDismiss(onClose);
  return (
    <div data-testid="backdrop" {...backdropDismiss}>
      <div data-testid="panel">
        <textarea data-testid="composer" />
      </div>
    </div>
  );
}

describe("useBackdropDismiss", () => {
  it("closes when the press starts and ends on the backdrop", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");

    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the press started inside the panel", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    // The exact shape of the keyboard bug: press lands on the textarea, the
    // layout shifts, and the click resolves on the backdrop.
    fireEvent.pointerDown(screen.getByTestId("composer"));
    fireEvent.click(screen.getByTestId("backdrop"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close on a click inside the panel", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    fireEvent.pointerDown(screen.getByTestId("composer"));
    fireEvent.click(screen.getByTestId("composer"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not latch: a blocked attempt leaves the next backdrop tap working", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const backdrop = screen.getByTestId("backdrop");

    fireEvent.pointerDown(screen.getByTestId("composer"));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
