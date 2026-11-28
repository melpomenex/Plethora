/**
 * ExtractScrollItem notes autosave regression test.
 *
 * Ensures that typing more notes while an earlier debounced autosave is
 * in flight (and its onUpdate echo updates extract.notes) never overwrites
 * or deletes the user's newer input.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ExtractScrollItem } from "../ExtractScrollItem";
import type { Extract } from "../../../api/extracts";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
  updateExtract: vi.fn(),
}));

vi.mock("../../../api/extracts", async () => {
  const actual = await vi.importActual<typeof import("../../../api/extracts")>("../../../api/extracts");
  return {
    ...actual,
    updateExtract: mocks.updateExtract,
  };
});

function translate(key: string) {
  switch (key) {
    case "extractScrollItem.notes":
      return "Notes";
    case "extractScrollItem.notesPlaceholder":
      return "Add notes...";
    default:
      return key;
  }
}

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: translate }),
}));

function makeExtract(overrides: Partial<Extract> = {}): Extract {
  return {
    id: "extract-1",
    document_id: "doc-1",
    content: "Original extract content.",
    notes: "",
    progressive_disclosure_level: 0,
    max_disclosure_level: 0,
    progressive_summaries: undefined,
    date_created: "2026-01-01T00:00:00Z",
    date_modified: "2026-01-01T00:00:00Z",
    tags: [],
    review_count: 0,
    reps: 0,
    ...overrides,
  };
}

function Harness({ initialExtract }: { initialExtract: Extract }) {
  const [extract, setExtract] = useState(initialExtract);
  return (
    <ExtractScrollItem
      extract={extract}
      documentTitle="Test Document"
      onRate={vi.fn()}
      onCreateCloze={vi.fn()}
      onCreateQA={vi.fn()}
      onUpdate={(updates) => {
        setExtract((prev) => ({
          ...prev,
          content: updates.content,
          ...(updates.html_content !== undefined ? { html_content: updates.html_content } : {}),
          notes: updates.notes,
        }));
      }}
    />
  );
}

describe("ExtractScrollItem notes autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.updateExtract.mockReset();
    const settings = JSON.parse(JSON.stringify(defaultSettings));
    settings.ai.aiControls.extractProgressiveSummaries = false;
    useSettingsStore.setState({ settings });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves newer typing when an in-flight autosave resolves and echoes older notes via onUpdate", async () => {
    let resolveFirstSave!: (value: Extract) => void;
    const firstSavePromise = new Promise<Extract>((resolve) => {
      resolveFirstSave = resolve;
    });
    mocks.updateExtract
      .mockImplementationOnce(() => firstSavePromise)
      .mockImplementation(async (input) => makeExtract({ notes: input.note ?? "" }));

    render(<Harness initialExtract={makeExtract()} />);

    const notesInput = screen.getByPlaceholderText("Add notes...") as HTMLTextAreaElement;
    fireEvent.change(notesInput, { target: { value: "hello " } });

    // Trigger the 800ms autosave for "hello "
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(1);
    expect(mocks.updateExtract).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "extract-1", note: "hello " })
    );

    // User keeps typing more words while the first save is still in flight
    fireEvent.change(notesInput, { target: { value: "hello world this is a longer note" } });
    expect(notesInput.value).toBe("hello world this is a longer note");

    // First save resolves and triggers onUpdate({ notes: "hello " })
    await act(async () => {
      resolveFirstSave(makeExtract({ notes: "hello " }));
      await Promise.resolve();
    });

    // Must NOT revert or delete the newer text
    expect(notesInput.value).toBe("hello world this is a longer note");

    // Second autosave fires after debounce and persists the full note
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(2);
    expect(mocks.updateExtract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "extract-1",
        note: "hello world this is a longer note",
      })
    );
  });

  it("resets notes when switching to a different extract id", () => {
    const first = makeExtract({ id: "extract-1", notes: "First note" });
    const second = makeExtract({ id: "extract-2", notes: "Second note" });

    const { rerender } = render(
      <ExtractScrollItem
        extract={first}
        documentTitle="Test Document"
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    const notesInput = screen.getByPlaceholderText("Add notes...") as HTMLTextAreaElement;
    expect(notesInput.value).toBe("First note");

    fireEvent.change(notesInput, { target: { value: "First note edited" } });
    expect(notesInput.value).toBe("First note edited");

    rerender(
      <ExtractScrollItem
        extract={second}
        documentTitle="Test Document"
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    expect(notesInput.value).toBe("Second note");
  });
});
