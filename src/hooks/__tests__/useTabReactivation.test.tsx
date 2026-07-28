import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTabReactivation } from "../useTabReactivation";

describe("useTabReactivation", () => {
  it("fires once each time a mounted tab becomes active again", () => {
    const onReactivate = vi.fn();

    function Probe({ active }: { active: boolean }) {
      useTabReactivation(active, onReactivate);
      return null;
    }

    const view = render(<Probe active />);
    expect(onReactivate).not.toHaveBeenCalled();

    view.rerender(<Probe active={false} />);
    expect(onReactivate).not.toHaveBeenCalled();

    view.rerender(<Probe active />);
    expect(onReactivate).toHaveBeenCalledTimes(1);

    view.rerender(<Probe active />);
    expect(onReactivate).toHaveBeenCalledTimes(1);

    view.rerender(<Probe active={false} />);
    view.rerender(<Probe active />);
    expect(onReactivate).toHaveBeenCalledTimes(2);
  });
});
