import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ReviewSettings } from "../ReviewSettings";
import { useSettingsStore } from "../../../stores/settingsStore";

describe("ReviewSettings", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
  });

  it("renders with search target id setting-queue-ordering-mode", () => {
    const { container } = render(<ReviewSettings />);
    const target = container.querySelector('[data-settings-search-target="setting-queue-ordering-mode"]');
    expect(target).not.toBeNull();
  });

  it("renders both Adaptive and Strict Manual options", () => {
    render(<ReviewSettings />);
    expect(screen.getByText("Adaptive")).toBeInTheDocument();
    expect(screen.getByText("Strict Manual")).toBeInTheDocument();

    const adaptiveRadio = screen.getByRole("radio", { name: /Adaptive/i });
    const manualRadio = screen.getByRole("radio", { name: /Strict Manual/i });

    expect(adaptiveRadio).toBeChecked();
    expect(manualRadio).not.toBeChecked();
  });

  it("toggles mode on selection and calls onChange callback", () => {
    const handleChange = vi.fn();
    render(<ReviewSettings onChange={handleChange} />);

    const manualRadio = screen.getByRole("radio", { name: /Strict Manual/i });
    fireEvent.click(manualRadio);

    expect(handleChange).toHaveBeenCalledWith("strict_manual");
    expect(useSettingsStore.getState().settings.smartQueue.queueOrderingMode).toBe("strict_manual");

    const adaptiveRadio = screen.getByRole("radio", { name: /Adaptive/i });
    fireEvent.click(adaptiveRadio);

    expect(handleChange).toHaveBeenCalledWith("adaptive");
    expect(useSettingsStore.getState().settings.smartQueue.queueOrderingMode).toBe("adaptive");
  });

  it("honors controlled value prop", () => {
    const { rerender } = render(<ReviewSettings value="strict_manual" />);
    const manualRadio = screen.getByRole("radio", { name: /Strict Manual/i });
    expect(manualRadio).toBeChecked();

    rerender(<ReviewSettings value="adaptive" />);
    const adaptiveRadio = screen.getByRole("radio", { name: /Adaptive/i });
    expect(adaptiveRadio).toBeChecked();
  });
});
