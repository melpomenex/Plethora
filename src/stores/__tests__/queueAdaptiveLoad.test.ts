import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ documents: [] }),
  },
}));

vi.mock("../collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({ activeCollectionId: null, documentAssignments: {} }),
  },
}));

vi.mock("../../api/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/queue")>();
  const item = {
    id: "q-1",
    documentId: "d-1",
    documentTitle: "Title",
    itemType: "document",
    priority: 1,
    estimatedTime: 5,
    tags: [] as string[],
    category: "",
    progress: 0,
  };
  return {
    ...actual,
    getQueue: vi.fn(async () => [item]),
    getDueDocumentsOnly: vi.fn(async () => [item]),
    getDueQueueItems: vi.fn(async () => [item]),
  };
});

import { useQueueStore } from "../queueStore";
import { useSettingsStore } from "../settingsStore";

describe("adaptive ranking on queue load", () => {
  const original = useQueueStore.getState().applyRankSnapshot;
  const wasRanking = useSettingsStore.getState().settings.daqe.rankingEnabled;

  beforeEach(() => {
    useQueueStore.setState({
      items: [],
      filteredItems: [],
      queueFilterMode: "due-all",
    });
  });

  afterEach(() => {
    useQueueStore.setState({ applyRankSnapshot: original });
    useSettingsStore.getState().updateSettingsCategory("daqe", { rankingEnabled: wasRanking });
    vi.clearAllMocks();
  });

  it("structures due items under the knobs when ranking is enabled", async () => {
    useSettingsStore.getState().updateSettingsCategory("daqe", { rankingEnabled: true });
    const spy = vi.fn(async () => {});
    useQueueStore.setState({ applyRankSnapshot: spy as never });

    await useQueueStore.getState().loadDueQueueItems();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual(
      useSettingsStore.getState().settings.daqe.knobs,
    );
  });

  it("structures the all-items listing when ranking is enabled", async () => {
    useSettingsStore.getState().updateSettingsCategory("daqe", { rankingEnabled: true });
    const spy = vi.fn(async () => {});
    useQueueStore.setState({ applyRankSnapshot: spy as never });

    await useQueueStore.getState().loadQueue(true);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("leaves the listing untouched when ranking is off", async () => {
    useSettingsStore.getState().updateSettingsCategory("daqe", { rankingEnabled: false });
    const spy = vi.fn(async () => {});
    useQueueStore.setState({ applyRankSnapshot: spy as never });

    await useQueueStore.getState().loadDueQueueItems();

    expect(spy).not.toHaveBeenCalled();
    expect(useQueueStore.getState().items).toHaveLength(1);
  });
});
