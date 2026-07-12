import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionButton, ActionMenu, NumericInput } from "../UI";
import { EmptyState } from "../EmptyState";

describe("core UI primitives", () => {
  it("renders a labelled primary action with keyboard focus styling", () => {
    render(<ActionButton variant="primary">Continue</ActionButton>);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toHaveClass("focus-visible:ring-2");
    expect(button).toHaveClass("bg-primary");
  });

  it("opens accessible menu actions and returns focus to the trigger", () => {
    const select = vi.fn();
    render(<ActionMenu label="More review actions" items={[{ label: "Import deck", onSelect: select }]} />);
    const trigger = screen.getByRole("button", { name: "More review actions" });
    fireEvent.click(trigger);
    const action = screen.getByRole("menuitem", { name: "Import deck" });
    fireEvent.click(action);
    expect(select).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it("routes the primary empty-state action", () => {
    const importDocument = vi.fn();
    render(<EmptyState title="No documents" description="Import a document to begin." action={{ label: "Import", onClick: importDocument }} />);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(importDocument).toHaveBeenCalledOnce();
  });
});

describe("NumericInput component", () => {
  it("renders with initial value", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("18");
  });

  it("calls onChange immediately on typing a valid number", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "20" } });
    expect(handleChange).toHaveBeenCalledWith(20);
    expect(input.value).toBe("20");
  });

  it("does not call onChange when cleared, but updates input display", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(handleChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("restores the previous value on blur if left empty", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenLastCalledWith(18);
    expect(input.value).toBe("18");
  });

  it("clamps to min value on blur", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} min={10} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    // onChange will be called with 5 since 5 is a valid number
    expect(handleChange).toHaveBeenCalledWith(5);
    // On blur, it should clamp to 10 and call onChange with 10
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenLastCalledWith(10);
    expect(input.value).toBe("10");
  });

  it("clamps to max value on blur", () => {
    const handleChange = vi.fn();
    render(<NumericInput value={18} max={30} onChange={handleChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "35" } });
    expect(handleChange).toHaveBeenCalledWith(35);
    fireEvent.blur(input);
    expect(handleChange).toHaveBeenLastCalledWith(30);
    expect(input.value).toBe("30");
  });
});

