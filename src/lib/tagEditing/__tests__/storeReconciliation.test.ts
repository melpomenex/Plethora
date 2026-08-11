import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyItemTagsToStores } from "../storeReconciliation";
import { useDocumentStore } from "../../../stores/documentStore";
import { useQueueStore } from "../../../stores/queueStore";
import { useExtractStore } from "../../../stores/extractStore";

describe("store reconciliation after tag mutations (2.3/3.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: [] });
    useQueueStore.setState({ items: [] });
    useExtractStore.setState({ extracts: [] });
  });

  it("merges tags into the matching document row locally", () => {
    useDocumentStore.setState({
      documents: [{ id: "d1", title: "Doc", tags: ["old"] } as never],
    });
    applyItemTagsToStores("document", "d1", ["new", "tags"]);
    const doc = useDocumentStore.getState().documents.find((d) => (d as { id: string }).id === "d1");
    expect((doc as { tags?: string[] })?.tags).toEqual(["new", "tags"]);
  });

  it("merges tags into the matching extract row locally", () => {
    useExtractStore.setState({
      extracts: [{ id: "e1", tags: ["old"] } as never],
    });
    applyItemTagsToStores("extract", "e1", ["new"]);
    const extract = useExtractStore.getState().extracts.find((e) => (e as { id: string }).id === "e1");
    expect((extract as { tags?: string[] })?.tags).toEqual(["new"]);
  });

  it("merges tags into the matching queue item locally", () => {
    useQueueStore.setState({
      items: [{ id: "li1", tags: ["old"] } as never],
    });
    applyItemTagsToStores("learning-item", "li1", ["new"]);
    const item = useQueueStore.getState().items.find((i) => (i as { id: string }).id === "li1");
    expect((item as { tags?: string[] })?.tags).toEqual(["new"]);
  });

  it("is a no-op for items not present in a store", () => {
    applyItemTagsToStores("document", "missing", ["x"]);
    expect(useDocumentStore.getState().documents).toEqual([]);
  });
});
