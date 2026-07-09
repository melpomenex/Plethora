import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionButton, ActionMenu } from "../UI";
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
