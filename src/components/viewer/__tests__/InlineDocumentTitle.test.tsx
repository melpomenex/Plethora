import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineDocumentTitle } from "../InlineDocumentTitle";

const labels = {
  renameLabel: "Rename document",
  inputLabel: "Document title",
};

describe("InlineDocumentTitle", () => {
  it("saves a trimmed title with Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<InlineDocumentTitle title="Old title" onSave={onSave} {...labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename document" }));
    const input = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.change(input, { target: { value: "  New title  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("New title"));
  });

  it("saves when focus leaves the input", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<InlineDocumentTitle title="Old title" onSave={onSave} {...labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename document" }));
    const input = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("New title"));
  });

  it("cancels with Escape and rejects an empty title", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<InlineDocumentTitle title="Old title" onSave={onSave} {...labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename document" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();

    rerender(<InlineDocumentTitle title="Old title" onSave={onSave} {...labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename document" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("restores the displayed title when saving fails", async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    render(<InlineDocumentTitle title="Old title" onSave={onSave} {...labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename document" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Old title")).toBeInTheDocument();
  });
});
