import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OnDeviceProcessingBadge } from "../OnDeviceProcessingBadge";

describe("OnDeviceProcessingBadge", () => {
  it("renders the on-device processing label", () => {
    const { container } = render(<OnDeviceProcessingBadge />);
    expect(screen.getByTestId("on-device-processing-badge")).toBeTruthy();
    expect(container.textContent).toMatch(/on-device|On-device|device/i);
  });
});
