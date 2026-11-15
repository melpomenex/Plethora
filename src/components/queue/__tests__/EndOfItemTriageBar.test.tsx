import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { EndOfItemTriageBar, isEditableEventTarget } from "../EndOfItemTriageBar";

describe("UX01-T03 EndOfItemTriageBar", () => {
  it("dispatches Space, E, Q, D, and P shortcuts when focus is outside editable elements", () => {
    const onNext = vi.fn();
    const onExtract = vi.fn();
    const onCreateQA = vi.fn();
    const onArchive = vi.fn();
    const onOpenPriority = vi.fn();

    render(
      <EndOfItemTriageBar
        onNext={onNext}
        onExtract={onExtract}
        onCreateQA={onCreateQA}
        onArchive={onArchive}
        onOpenPriority={onOpenPriority}
      />
    );

    expect(document.querySelector("[data-end-of-item-triage-bar='true']")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "q" });
    expect(onCreateQA).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "e" });
    expect(onExtract).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "d" });
    expect(onArchive).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "p" });
    expect(onOpenPriority).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: " " });
    expect(onNext).toHaveBeenCalledTimes(1);

    // Button clicks also work directly
    fireEvent.click(screen.getByRole("button", { name: "Create Q&A" }));
    expect(onCreateQA).toHaveBeenCalledTimes(2);
  });

  it("suppresses triage hotkeys when focus or event target is inside editable fields or split sheets", () => {
    const onNext = vi.fn();
    const onExtract = vi.fn();
    const onCreateQA = vi.fn();
    const onArchive = vi.fn();
    const onOpenPriority = vi.fn();

    render(
      <div>
        <textarea aria-label="Notes" />
        <input aria-label="Search" />
        <div data-testid="rich-editor" contentEditable="true" tabIndex={0} />
        <div className="ProseMirror" data-testid="prosemirror" tabIndex={0}>
          <span>Editable paragraph</span>
        </div>
        <div data-split-sheet="true" data-testid="split-sheet" tabIndex={0}>
          <button type="button">Inside sheet</button>
        </div>
        <EndOfItemTriageBar
          onNext={onNext}
          onExtract={onExtract}
          onCreateQA={onCreateQA}
          onArchive={onArchive}
          onOpenPriority={onOpenPriority}
        />
      </div>
    );

    const textarea = screen.getByLabelText("Notes");
    const input = screen.getByLabelText("Search");
    const rich = screen.getByTestId("rich-editor");
    const prose = screen.getByTestId("prosemirror");
    const sheetButton = screen.getByRole("button", { name: "Inside sheet" });

    expect(isEditableEventTarget(textarea)).toBe(true);
    expect(isEditableEventTarget(input)).toBe(true);
    expect(isEditableEventTarget(rich)).toBe(true);
    expect(isEditableEventTarget(prose)).toBe(true);
    expect(isEditableEventTarget(sheetButton)).toBe(true);

    for (const target of [textarea, input, rich, prose, sheetButton]) {
      (target as HTMLElement).focus();
      for (const key of [" ", "e", "q", "d", "p"]) {
        fireEvent.keyDown(target, { key });
        fireEvent.keyDown(window, { key });
      }
    }

    expect(onNext).not.toHaveBeenCalled();
    expect(onExtract).not.toHaveBeenCalled();
    expect(onCreateQA).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
    expect(onOpenPriority).not.toHaveBeenCalled();
  });
});
