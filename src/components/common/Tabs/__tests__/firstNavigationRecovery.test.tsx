import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabContent } from "../TabContent";
import type { Tab } from "../../../../stores";

const mockGetDocuments = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../../api/documents")>(
    "../../../../api/documents",
  );
  return {
    ...actual,
    getDocuments: mockGetDocuments,
  };
});

import { lazy, type ComponentType } from "react";
import { useCollectionStore } from "../../../../stores/collectionStore";
import { useDocumentStore } from "../../../../stores/documentStore";

function createRetryableLazy<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): ComponentType<any> {
  let cachedLazy: ComponentType<any> | null = null;
  let lastFailed = false;
  const create = () =>
    lazy(() =>
      loader().catch((err) => {
        lastFailed = true;
        throw err;
      }),
    );
  return function Retryable(props: Record<string, unknown>) {
    if (!cachedLazy || lastFailed) {
      lastFailed = false;
      cachedLazy = create();
    }
    const Comp = cachedLazy;
    return <Comp {...props} />;
  };
}

describe("first-navigation recovery and store race guards", () => {
  beforeEach(() => {
    mockGetDocuments.mockReset();
    useCollectionStore.setState({ activeCollectionId: "col-a" });
    useDocumentStore.setState({
      documents: [],
      isLoading: false,
      error: null,
      hasCompletedFirstLoad: false,
    });
  });

  it("recovers a failed lazy view in place when Retry is clicked without navigating away", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldFail = true;
    let attempts = 0;
    const FlakyView = createRetryableLazy(async () => {
      attempts += 1;
      if (shouldFail) throw new Error("Chunk fetch failed");
      return { default: () => <div>Recovered on retry</div> };
    });

    const tab: Tab = {
      id: "flaky",
      title: "Flaky",
      icon: null,
      type: "analytics",
      content: FlakyView,
      closable: true,
    };

    render(<TabContent tabs={[tab]} activeTabId="flaky" />);

    expect(await screen.findByText(/Chunk fetch failed/i)).toBeInTheDocument();
    shouldFail = false;
    const retryBtn = screen.getByRole("button");
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(await screen.findByText("Recovered on retry")).toBeInTheDocument();
    expect(attempts).toBeGreaterThanOrEqual(2);
    consoleError.mockRestore();
  });

  it("does not clear isLoading or clobber documents when a stale collection fetch resolves late", async () => {
    let resolveA!: (docs: any[]) => void;
    let resolveB!: (docs: any[]) => void;
    mockGetDocuments
      .mockImplementationOnce(() => new Promise((res) => { resolveA = res; }))
      .mockImplementationOnce(() => new Promise((res) => { resolveB = res; }));

    const loadA = useDocumentStore.getState().loadDocuments();
    expect(useDocumentStore.getState().isLoading).toBe(true);

    // User switches to collection B before A settles.
    useCollectionStore.setState({ activeCollectionId: "col-b" });
    const loadB = useDocumentStore.getState().loadDocuments();

    // Collection A resolves late: must NOT clear isLoading while B is still in flight.
    await act(async () => {
      resolveA([{ id: "doc-a", title: "Doc A", fileType: "pdf" }]);
      await loadA;
    });
    expect(useDocumentStore.getState().isLoading).toBe(true);
    expect(useDocumentStore.getState().documents).toEqual([]);

    // Collection B resolves: becomes the authoritative state.
    await act(async () => {
      resolveB([{ id: "doc-b", title: "Doc B", fileType: "pdf" }]);
      await loadB;
    });
    expect(useDocumentStore.getState().isLoading).toBe(false);
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-b"]);
  });
});
