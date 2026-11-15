import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import {
  BreakoutOverlayModal,
  clampBreakoutScale,
  useBreakoutOverlay,
} from "../BreakoutOverlayModal";

function BreakoutHarness() {
  const ref = useRef<HTMLDivElement>(null);
  const { breakoutTrigger, breakoutModal } = useBreakoutOverlay(ref);
  return (
    <div>
      <div ref={ref}>
        <table>
          <thead>
            <tr>
              <th>Column A</th>
              <th>Column B</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Value 1</td>
              <td>Value 2</td>
            </tr>
          </tbody>
        </table>
      </div>
      {breakoutTrigger}
      {breakoutModal}
    </div>
  );
}

describe("BreakoutOverlayModal", () => {
  it("clamps zoom scale strictly between 0.5x and 3.0x", () => {
    expect(clampBreakoutScale(0.1)).toBe(0.5);
    expect(clampBreakoutScale(1.25)).toBe(1.25);
    expect(clampBreakoutScale(4.5)).toBe(3.0);
  });

  it("shows Breakout View trigger on block hover and opens modal with zoom/reset", () => {
    render(<BreakoutHarness />);
    const table = document.querySelector("table")!;
    fireEvent.mouseOver(table);

    const trigger = screen.getByRole("button", { name: /Breakout View/i });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Table Breakout View" });
    expect(dialog).toBeInTheDocument();
    expect(document.querySelector('[data-breakout-scale="true"]')).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(document.querySelector('[data-breakout-scale="true"]')).toHaveTextContent("125%");

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(document.querySelector('[data-breakout-scale="true"]')).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom and pan" }));
    expect(document.querySelector('[data-breakout-scale="true"]')).toHaveTextContent("100%");
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    render(
      <BreakoutOverlayModal
        isOpen={true}
        title="Code Breakout View"
        contentHtml="<pre><code>const x = 1;</code></pre>"
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
