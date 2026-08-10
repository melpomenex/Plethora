import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExtractsTab } from "../ExtractsTab";
import type { Extract } from "../../../api/extracts";

// Control the extract store's observable state per test. The component reads
// four selectors from the store; the mock returns them from this mutable
// object, which each test sets before rendering.
const mockStore = vi.hoisted(() => ({
  extracts: [] as Extract[],
  isLoading: false,
  error: null as string | null,
  loadExtracts: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../../stores/extractStore", () => ({
  useExtractStore: (selector: (state: unknown) => unknown) =>
    selector({
      extracts: mockStore.extracts,
      isLoading: mockStore.isLoading,
      error: mockStore.error,
      loadExtracts: mockStore.loadExtracts,
    }),
}));

// ExtractsList has its own tests; the tab only composes it per document group,
// so stub it to keep this test focused on the tab's grouping and states.
vi.mock("../../extracts/ExtractsList", () => ({
  ExtractsList: ({ documentId }: { documentId: string }) => (
    <div data-testid={`extracts-list-${documentId}`} />
  ),
}));

const makeExtract = (id: string, documentId: string, overrides: Partial<Extract> = {}): Extract => ({
  id,
  document_id: documentId,
  content: `Content ${id}`,
  progressive_disclosure_level: 0,
  max_disclosure_level: 0,
  date_created: "2024-01-01T00:00:00.000Z",
  date_modified: "2024-01-01T00:00:00.000Z",
  tags: [],
  review_count: 0,
  reps: 0,
  ...overrides,
});

describe("ExtractsTab", () => {
  beforeEach(() => {
    mockStore.extracts = [];
    mockStore.isLoading = false;
    mockStore.error = null;
    mockStore.loadExtracts.mockReset();
    mockStore.loadExtracts.mockResolvedValue(undefined);
  });

  it("loads library-wide extracts on mount (no document filter)", () => {
    render(<ExtractsTab />);
    expect(mockStore.loadExtracts).toHaveBeenCalledTimes(1);
    expect(mockStore.loadExtracts).toHaveBeenCalledWith();
  });

  it("shows a loading state while the store is loading", () => {
    mockStore.isLoading = true;
    render(<ExtractsTab />);
    expect(screen.getByText("Loading extracts...")).toBeInTheDocument();
  });

  it("shows an empty state explaining how to create extracts when the library has none", () => {
    render(<ExtractsTab />);
    expect(screen.getByText("No extracts yet")).toBeInTheDocument();
    expect(screen.getByText(/Select text in any document/)).toBeInTheDocument();
    expect(screen.queryByTestId(/extracts-list-/)).not.toBeInTheDocument();
  });

  it("groups extracts by source document, newest group first, with a list section per group", () => {
    mockStore.extracts = [
      makeExtract("e1", "doc-a", { page_title: "Doc A" }),
      makeExtract("e2", "doc-b", { page_title: "Doc B", date_created: "2024-02-01T00:00:00.000Z" }),
      // Newest extract overall → its group (doc-a) must come first.
      makeExtract("e3", "doc-a", { date_created: "2024-03-01T00:00:00.000Z" }),
    ];

    const { container } = render(<ExtractsTab />);

    expect(screen.getByTestId("extracts-list-doc-a")).toBeInTheDocument();
    expect(screen.getByTestId("extracts-list-doc-b")).toBeInTheDocument();

    const sections = Array.from(container.querySelectorAll("section"));
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain("Doc A");
    expect(sections[1].textContent).toContain("Doc B");
  });

  it("falls back to a generic title when the document is unknown", () => {
    mockStore.extracts = [makeExtract("e1", "doc-unknown")];
    render(<ExtractsTab />);
    expect(screen.getByText("Untitled document")).toBeInTheDocument();
  });

  it("shows the empty state when the library only has extracts without a source document", () => {
    // Extracts with no document_id (browser-extension drops) have no source to
    // jump to and cannot render through the per-document ExtractsList, so they
    // are skipped rather than shown in a dead fallback group.
    mockStore.extracts = [makeExtract("e1", "")];
    render(<ExtractsTab />);
    expect(screen.getByText("No extracts yet")).toBeInTheDocument();
    expect(screen.queryByTestId(/extracts-list-/)).not.toBeInTheDocument();
  });

  it("shows an error state with a retry control when loading fails, and does not crash", () => {
    mockStore.error = "boom";
    render(<ExtractsTab />);
    expect(screen.getByText("Failed to load extracts")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "Retry" });
    retry.click();
    // One call on mount, one on retry.
    expect(mockStore.loadExtracts).toHaveBeenCalledTimes(2);
  });
});
