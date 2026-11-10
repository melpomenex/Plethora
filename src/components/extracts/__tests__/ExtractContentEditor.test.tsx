import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ExtractContentEditor,
  indentContent,
  outdentContent,
} from "../ExtractContentEditor";
import { useState } from "react";

describe("indentContent & outdentContent helpers", () => {
  it("indents at single cursor by inserting 2 spaces", () => {
    const text = "helloworld";
    const result = indentContent(text, 5, 5);
    expect(result.text).toBe("hello  world");
    expect(result.start).toBe(7);
    expect(result.end).toBe(7);
  });

  it("indents across multiline selection by prefixing 2 spaces on each line", () => {
    const text = "line1\nline2\nline3";
    // select from line1 into line2
    const result = indentContent(text, 2, 8);
    expect(result.text).toBe("  line1\n  line2\nline3");
    expect(result.start).toBe(4);
    expect(result.end).toBe(12);
  });

  it("outdents at cursor if immediately preceded by 2 spaces", () => {
    const text = "  hello";
    const result = outdentContent(text, 2, 2);
    expect(result.text).toBe("hello");
    expect(result.start).toBe(0);
    expect(result.end).toBe(0);
  });

  it("outdents multiline selection by removing up to 2 leading spaces per line", () => {
    const text = "  line1\n  line2\n    line3";
    const result = outdentContent(text, 2, 18);
    expect(result.text).toBe("line1\nline2\n  line3");
    expect(result.start).toBe(0);
  });
});

function EditorHarness(props: { initialValue?: string }) {
  const [val, setVal] = useState(props.initialValue ?? "hello\nworld");
  return (
    <ExtractContentEditor
      value={val}
      onChange={setVal}
      data-testid="extract-editor"
      aria-label="Extract Content"
    />
  );
}

describe("ExtractContentEditor", () => {
  it("renders textarea and toolbar buttons including indent and outdent", () => {
    render(<EditorHarness />);
    expect(screen.getByRole("textbox", { name: "Extract Content" })).toBeInTheDocument();
    expect(screen.getByTestId("editor-indent-btn")).toBeInTheDocument();
    expect(screen.getByTestId("editor-outdent-btn")).toBeInTheDocument();
  });

  it("indents and outdents via toolbar buttons", async () => {
    render(<EditorHarness initialValue="test text" />);
    const textarea = screen.getByRole("textbox", { name: "Extract Content" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    const indentBtn = screen.getByTestId("editor-indent-btn");
    fireEvent.click(indentBtn);
    expect(textarea.value).toBe("  test text");

    const outdentBtn = screen.getByTestId("editor-outdent-btn");
    textarea.setSelectionRange(2, 2);
    fireEvent.click(outdentBtn);
    expect(textarea.value).toBe("test text");
  });

  it("handles Tab and Shift-Tab keybindings in textarea", async () => {
    render(<EditorHarness initialValue="code line" />);
    const textarea = screen.getByRole("textbox", { name: "Extract Content" }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    // Tab -> indent
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab" });
    expect(textarea.value).toBe("  code line");

    // Shift-Tab -> outdent
    textarea.setSelectionRange(2, 2);
    fireEvent.keyDown(textarea, { key: "Tab", code: "Tab", shiftKey: true });
    expect(textarea.value).toBe("code line");
  });
});
