import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExtractReader } from "../ExtractReader";
import type { Extract } from "../../../api/extracts";

const getExtractMock = vi.hoisted(() => vi.fn());
const getDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api/extracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/extracts")>();
  return { ...actual, getExtract: getExtractMock };
});
vi.mock("../../../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/documents")>();
  return { ...actual, getDocument: getDocumentMock };
});

const makeExtract = (id: string, content: string): Extract => ({
  id,
  document_id: `doc-${id}`,
  content,
  progressive_disclosure_level: 0,
  max_disclosure_level: 0,
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  tags: [],
  review_count: 0,
  reps: 0,
});

describe("ExtractReader", () => {
  beforeEach(() => {
    getExtractMock.mockReset();
    getDocumentMock.mockReset();
    getDocumentMock.mockResolvedValue({ id: "doc-1", title: "Doc", content: "src" });
  });

  it("fetches the extract once and holds it across unrelated re-renders (no flicker)", async () => {
    getExtractMock.mockResolvedValue(makeExtract("e1", "FULL EXTRACT TEXT"));

    const { rerender } = render(
      <ExtractReader extractId="e1" documentId="doc-1" documentTitle="Doc" />,
    );

    await waitFor(() => {
      expect(screen.getByText("FULL EXTRACT TEXT")).toBeInTheDocument();
    });
    expect(getExtractMock).toHaveBeenCalledTimes(1);

    // An unrelated re-render (parent re-render) must NOT refetch nor blank the
    // content — the reported flicker was a render → new t → effect reset
    // (setExtract(null)) → refetch → re-render loop.
    rerender(<ExtractReader extractId="e1" documentId="doc-1" documentTitle="Doc" />);

    expect(getExtractMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("FULL EXTRACT TEXT")).toBeInTheDocument();
    // The loading spinner must not reappear on the re-render.
    expect(screen.queryByText("Loading extract…")).not.toBeInTheDocument();
  });

  it("switching to a different extract refetches and replaces the content", async () => {
    getExtractMock.mockImplementation(async (id: string) =>
      makeExtract(id, id === "e1" ? "FIRST EXTRACT" : "SECOND EXTRACT"),
    );

    const { rerender } = render(
      <ExtractReader extractId="e1" documentId="doc-1" documentTitle="Doc" />,
    );
    await waitFor(() => {
      expect(screen.getByText("FIRST EXTRACT")).toBeInTheDocument();
    });

    rerender(<ExtractReader extractId="e2" documentId="doc-1" documentTitle="Doc" />);
    await waitFor(() => {
      expect(screen.getByText("SECOND EXTRACT")).toBeInTheDocument();
    });
    expect(screen.queryByText("FIRST EXTRACT")).not.toBeInTheDocument();
    expect(getExtractMock).toHaveBeenCalledTimes(2);
    expect(getExtractMock).toHaveBeenLastCalledWith("e2");
  });

  it("shows the not-found state when the extract does not exist", async () => {
    getExtractMock.mockResolvedValue(null);

    render(<ExtractReader extractId="missing" documentId="doc-1" documentTitle="Doc" />);

    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
    expect(getExtractMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a fetch failure as an error without crashing", async () => {
    getExtractMock.mockRejectedValue(new Error("backend unavailable"));

    render(<ExtractReader extractId="e1" documentId="doc-1" documentTitle="Doc" />);

    await waitFor(() => {
      expect(screen.getByText("backend unavailable")).toBeInTheDocument();
    });
    expect(getExtractMock).toHaveBeenCalledTimes(1);
  });
});
