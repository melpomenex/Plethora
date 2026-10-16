import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantScopeSelector } from "../AssistantScopeSelector";
describe("AssistantScopeSelector", () => {
  it("exposes three explicit scopes and preserves the selected scope", () => {
    const onChange = vi.fn();
    render(<AssistantScopeSelector value="chat" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Document" })); expect(onChange).toHaveBeenCalledWith("document");
    fireEvent.click(screen.getByRole("button", { name: "Library" })); expect(onChange).toHaveBeenCalledWith("library");
  });
  it("disables scope changes while a turn is running", () => {
    const onChange = vi.fn(); render(<AssistantScopeSelector value="document" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Chat" })); expect(onChange).not.toHaveBeenCalled();
  });
});
