import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const zoomState = vi.hoisted(() => ({
  current: {
    percent: 100,
    supported: true,
    applying: false,
    appliedPercent: 100,
    error: null as string | null,
    errorNonce: 0,
    canIncrease: true,
    canDecrease: true,
    canReset: false,
  },
}));

vi.mock("../../../hooks/useInterfaceZoom", () => ({
  useInterfaceZoomState: () => zoomState.current,
}));

vi.mock("../../../lib/interfaceZoom/controller", () => ({
  zoomInterfaceIn: vi.fn(),
  zoomInterfaceOut: vi.fn(),
  resetInterfaceZoom: vi.fn(),
  setInterfaceZoomPercent: vi.fn(),
}));

import { InterfaceZoomControl } from "../InterfaceZoomControl";
import {
  resetInterfaceZoom,
  setInterfaceZoomPercent,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "../../../lib/interfaceZoom/controller";
import { useSettingsStore } from "../../../stores/settingsStore";

function setState(patch: Partial<typeof zoomState.current>) {
  zoomState.current = { ...zoomState.current, ...patch };
}

beforeEach(() => {
  zoomState.current = {
    percent: 100,
    supported: true,
    applying: false,
    appliedPercent: 100,
    error: null,
    errorNonce: 0,
    canIncrease: true,
    canDecrease: true,
    canReset: false,
  };
  vi.mocked(zoomInterfaceIn).mockReset();
  vi.mocked(zoomInterfaceOut).mockReset();
  vi.mocked(resetInterfaceZoom).mockReset();
  vi.mocked(setInterfaceZoomPercent).mockReset();
  useSettingsStore.getState().resetSettings();
});

describe("InterfaceZoomControl", () => {
  it("shows the percentage readout and an accessible slider", () => {
    render(<InterfaceZoomControl />);

    expect(screen.getByText("100%")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Interface Zoom" });
    expect(slider).toHaveAttribute("min", "70");
    expect(slider).toHaveAttribute("max", "150");
    expect(slider).toHaveAttribute("step", "10");
    expect(slider).toHaveAttribute("aria-valuetext", "100%");
  });

  it("names the icon buttons and routes their actions through the controller", () => {
    render(<InterfaceZoomControl />);

    fireEvent.click(screen.getByRole("button", { name: "Decrease interface zoom" }));
    expect(zoomInterfaceOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Increase interface zoom" }));
    expect(zoomInterfaceIn).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("slider", { name: "Interface Zoom" }), {
      target: { value: "120" },
    });
    expect(setInterfaceZoomPercent).toHaveBeenCalledWith(120);
  });

  it("disables reset at 100 and the boundary buttons at the bounds", () => {
    const view = render(<InterfaceZoomControl />);
    expect(screen.getByRole("button", { name: "Reset to 100%" })).toBeDisabled();

    setState({
      percent: 70,
      canDecrease: false,
      canReset: true,
    });
    view.rerender(<InterfaceZoomControl />);
    expect(screen.getByRole("button", { name: "Decrease interface zoom" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase interface zoom" })).toBeEnabled();

    setState({
      percent: 150,
      canIncrease: false,
      canDecrease: true,
    });
    view.rerender(<InterfaceZoomControl />);
    expect(screen.getByRole("button", { name: "Increase interface zoom" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease interface zoom" })).toBeEnabled();
  });

  it("resets through the controller", () => {
    setState({ percent: 130, canReset: true });
    render(<InterfaceZoomControl />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to 100%" }));
    expect(resetInterfaceZoom).toHaveBeenCalledTimes(1);
  });

  it("replaces the controls with a non-interactive explanation when unsupported", () => {
    setState({ supported: false, canIncrease: false, canDecrease: false, canReset: false });
    render(<InterfaceZoomControl />);

    expect(
      screen.getByText(
        "Interface zoom is available only in the desktop app on a supported OS.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an inline error with a retry affordance", () => {
    render(<InterfaceZoomControl />);
    fireEvent.click(screen.getByRole("button", { name: "Increase interface zoom" }));

    setState({
      appliedPercent: 100,
      error: "denied",
      errorNonce: 1,
      percent: 100,
    });
    render(<InterfaceZoomControl />);

    expect(
      screen.getAllByText("Could not change interface zoom. Your previous setting was restored.")
        .length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(zoomInterfaceIn).toHaveBeenCalledTimes(2);
  });

  it("clears the inline error after a successful retry", () => {
    setState({ error: "denied", errorNonce: 1 });
    const view = render(<InterfaceZoomControl />);
    expect(
      screen.getByText("Could not change interface zoom. Your previous setting was restored."),
    ).toBeInTheDocument();

    setState({ error: null, errorNonce: 1, percent: 110 });
    view.rerender(<InterfaceZoomControl />);
    expect(
      screen.queryByText("Could not change interface zoom. Your previous setting was restored."),
    ).not.toBeInTheDocument();
  });

  it("never writes the settings store directly", () => {
    const update = vi.spyOn(
      useSettingsStore.getState(),
      "updateSettingsCategory",
    );
    render(<InterfaceZoomControl />);
    fireEvent.click(screen.getByRole("button", { name: "Increase interface zoom" }));
    fireEvent.change(screen.getByRole("slider", { name: "Interface Zoom" }), {
      target: { value: "140" },
    });
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });
});
