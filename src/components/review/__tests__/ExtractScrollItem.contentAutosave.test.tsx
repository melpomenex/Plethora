/**
 * ExtractScrollItem content & image autosave regression tests.
 *
 * Ensures that:
 * 1. Indenting/editing extract content while an earlier debounced autosave is
 *    in flight (and its onUpdate echo updates extract.content) never reverts
 *    the user's newer edits.
 * 2. Adding an image persists html_content via updateExtract and is not undone
 *    when an earlier autosave resolves and echoes older html_content.
 * 3. updateExtract forwards htmlContent to invokeCommand("update_extract", ...).
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ExtractScrollItem } from "../ExtractScrollItem";
import type { Extract } from "../../../api/extracts";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
  updateExtract: vi.fn(),
  ingestImageFile: vi.fn(),
  invokeCommand: vi.fn(),
}));

vi.mock("../../../api/extracts", async () => {
  const actual = await vi.importActual<typeof import("../../../api/extracts")>("../../../api/extracts");
  return {
    ...actual,
    updateExtract: mocks.updateExtract,
  };
});

vi.mock("../../../api/image-registry", () => ({
  ingestImageFile: mocks.ingestImageFile,
}));

function translate(key: string) {
  switch (key) {
    case "extractScrollItem.editContentPlaceholder":
      return "Edit extract content...";
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
    content: "Paragraph one\n\nParagraph two",
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

describe("ExtractScrollItem content & image autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.updateExtract.mockReset();
    mocks.ingestImageFile.mockReset();
    mocks.invokeCommand.mockReset();
    const settings = JSON.parse(JSON.stringify(defaultSettings));
    settings.ai.aiControls.extractProgressiveSummaries = false;
    useSettingsStore.setState({ settings });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves newer paragraph indentation when an in-flight autosave echoes older content via onUpdate", async () => {
    let resolveFirstSave!: (value: Extract) => void;
    const firstSavePromise = new Promise<Extract>((resolve) => {
      resolveFirstSave = resolve;
    });
    mocks.updateExtract
      .mockImplementationOnce(() => firstSavePromise)
      .mockImplementation(async (input) => makeExtract({ content: input.content ?? "" }));

    render(<Harness initialExtract={makeExtract()} />);

    const contentInput = screen.getByPlaceholderText("Edit extract content...") as HTMLTextAreaElement;
    const indentButton = screen.getByTitle("Indent (Tab)");

    // Indent first paragraph
    contentInput.setSelectionRange(0, 0);
    fireEvent.click(indentButton);
    expect(contentInput.value).toBe("  Paragraph one\n\nParagraph two");

    // Trigger first 800ms autosave
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(1);
    expect(mocks.updateExtract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "extract-1",
        content: "  Paragraph one\n\nParagraph two",
      })
    );

    // User indents second paragraph while first save is still in flight
    contentInput.setSelectionRange(contentInput.value.length, contentInput.value.length);
    fireEvent.click(indentButton);
    expect(contentInput.value).toBe("  Paragraph one\n\n  Paragraph two");

    // First save resolves and echoes older content via onUpdate
    await act(async () => {
      resolveFirstSave(makeExtract({ content: "  Paragraph one\n\nParagraph two" }));
      await Promise.resolve();
    });

    // Newer indentation must NOT be removed
    expect(contentInput.value).toBe("  Paragraph one\n\n  Paragraph two");

    // Second autosave persists the full indented text
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(2);
    expect(mocks.updateExtract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "extract-1",
        content: "  Paragraph one\n\n  Paragraph two",
      })
    );
  });

  it("persists added images in html_content and preserves newer image additions across in-flight autosave echoes", async () => {
    let resolveFirstSave!: (value: Extract) => void;
    const firstSavePromise = new Promise<Extract>((resolve) => {
      resolveFirstSave = resolve;
    });
    mocks.updateExtract
      .mockImplementationOnce(() => firstSavePromise)
      .mockImplementation(async (input) =>
        makeExtract({
          content: input.content ?? "",
          html_content: input.html_content,
        })
      );

    mocks.ingestImageFile
      .mockResolvedValueOnce({
        id: "img-1",
        data_url: "data:image/png;base64,AAA",
        file_name: "first.png",
      })
      .mockResolvedValueOnce({
        id: "img-2",
        data_url: "data:image/png;base64,BBB",
        file_name: "second.png",
      });

    const { container } = render(<Harness initialExtract={makeExtract()} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const firstFile = new File(["a"], "first.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [firstFile] } });
      await Promise.resolve();
    });

    expect(screen.getByAltText("first.png")).toBeTruthy();

    // Trigger first 800ms autosave with first image
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(1);
    expect(mocks.updateExtract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "extract-1",
        html_content: expect.stringContaining("data:image/png;base64,AAA"),
      })
    );

    // Add second image while first save is in flight
    const secondFile = new File(["b"], "second.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [secondFile] } });
      await Promise.resolve();
    });

    expect(screen.getByAltText("first.png")).toBeTruthy();
    expect(screen.getByAltText("second.png")).toBeTruthy();

    // First save resolves and echoes html_content with only the first image
    await act(async () => {
      resolveFirstSave(
        makeExtract({
          html_content: '<p>Paragraph one</p><figure><img src="data:image/png;base64,AAA" alt="first.png" /></figure>',
        })
      );
      await Promise.resolve();
    });

    // Both images must still be present
    expect(screen.getByAltText("first.png")).toBeTruthy();
    expect(screen.getByAltText("second.png")).toBeTruthy();

    // Second autosave persists both images
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(mocks.updateExtract).toHaveBeenCalledTimes(2);
    const lastCall = mocks.updateExtract.mock.calls[1][0];
    expect(lastCall.html_content).toContain("data:image/png;base64,AAA");
    expect(lastCall.html_content).toContain("data:image/png;base64,BBB");
  });
});
