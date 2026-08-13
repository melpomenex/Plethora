import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { buildMediaTranscriptSections } from "../../utils/sectionIndex";
import { useDocumentSections } from "../useDocumentSections";

afterEach(() => {
  cleanup();
  act(() => {
    useDocumentOutlineStore.setState({
      outlineByDocId: new Map(),
      mediaSectionsByDocId: new Map(),
    });
  });
});

describe("useDocumentSections media catalog", () => {
  it("prefers the viewer-published audiobook chapters over flattened transcript headings", () => {
    const mediaSections = buildMediaTranscriptSections(
      "book-1",
      [
        { id: 1, title: "001", startTime: 0, endTime: 60 },
        { id: 8, title: "008", startTime: 60, endTime: 120 },
      ],
      [
        { startTime: 5, endTime: 20, text: "Foreword" },
        { startTime: 70, endTime: 90, text: "Neocortex" },
      ],
    );
    act(() => {
      useDocumentOutlineStore.setState({
        mediaSectionsByDocId: new Map([["book-1", mediaSections]]),
      });
    });

    const { result } = renderHook(() => useDocumentSections({
      documentId: "book-1",
      content: "# Foreword\nOnly a heading rebuilt from flattened text.",
    }));

    expect(result.current.flat).toBe(mediaSections);
    expect(result.current.flat.map((section) => section.title)).toEqual(["001", "008"]);
    expect(result.current.getById(mediaSections[1].id)?.content).toBe("Neocortex");
  });
});
