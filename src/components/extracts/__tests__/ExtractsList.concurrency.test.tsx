import { render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExtracts: vi.fn(),
  getExtractsByDocument: vi.fn(),
  deleteExtract: vi.fn(),
  updateExtract: vi.fn(),
  extractDocumentText: vi.fn(),
}));

vi.mock("../../../api/extracts", () => ({
  getExtracts: mocks.getExtracts,
  getExtractsByDocument: mocks.getExtractsByDocument,
  deleteExtract: mocks.deleteExtract,
  updateExtract: mocks.updateExtract,
}));
vi.mock("../../../api/documents", () => ({
  extractDocumentText: mocks.extractDocumentText,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: (selector?: (state: { documents: unknown[] }) => unknown) =>
    typeof selector === "function" ? selector({ documents: [] }) : { documents: [] },
}));

import { ExtractsList } from "../ExtractsList";
import { useExtractStore } from "../../../stores/extractStore";

describe("ExtractsList concurrency and store reactivity (Tasks 3.2, 3.3, 5.4, 6.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractDocumentText.mockResolvedValue({ content: "" });
    useExtractStore.setState({ extracts: [], revision: 0, loadedDocumentId: null });
  });

  it("updates extracts immediately when useExtractStore updates for the document", async () => {
    mocks.getExtracts.mockResolvedValue([
      { id: "ext-1", document_id: "doc-1", content: "Initial extract 1", date_created: "2026-08-18" },
    ]);

    render(<ExtractsList documentId="doc-1" />);

    await waitFor(() => {
      expect(screen.getByText("Initial extract 1")).toBeInTheDocument();
    });

    // Simulate store notification of a newly created extract for doc-1
    await act(async () => {
      useExtractStore.setState({
        loadedDocumentId: "doc-1",
        extracts: [
          { id: "ext-1", document_id: "doc-1", content: "Initial extract 1", date_created: "2026-08-18" } as never,
          { id: "ext-2", document_id: "doc-1", content: "Newly added extract 2", date_created: "2026-08-18" } as never,
        ],
        revision: 1,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Newly added extract 2")).toBeInTheDocument();
    });
  });

  it("discards superseded responses during rapid documentId switching", async () => {
    let resolveDocA: ((val: unknown) => void) | undefined;
    let resolveDocB: ((val: unknown) => void) | undefined;

    mocks.getExtracts.mockImplementation((docId: string) => {
      if (docId === "doc-A") {
        return new Promise((resolve) => {
          resolveDocA = resolve;
        });
      }
      if (docId === "doc-B") {
        return new Promise((resolve) => {
          resolveDocB = resolve;
        });
      }
      return Promise.resolve([]);
    });

    const { rerender } = render(<ExtractsList documentId="doc-A" />);

    // Quickly switch to document B before document A resolves
    rerender(<ExtractsList documentId="doc-B" />);

    // Resolve doc B first
    await act(async () => {
      resolveDocB?.([{ id: "ext-b", document_id: "doc-B", content: "Extract for Doc B", date_created: "2026-08-18" }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Extract for Doc B")).toBeInTheDocument();
    });

    // Late resolution for superseded doc A
    await act(async () => {
      resolveDocA?.([{ id: "ext-a", document_id: "doc-A", content: "Stale Extract for Doc A", date_created: "2026-08-18" }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Verify stale doc A extract is NOT rendered
    await waitFor(() => {
      expect(screen.queryByText("Stale Extract for Doc A")).toBeNull();
      expect(screen.getByText("Extract for Doc B")).toBeInTheDocument();
    });
  });
});
