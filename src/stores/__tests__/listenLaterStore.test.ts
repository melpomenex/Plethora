import { describe, it, expect, beforeEach, vi } from "vitest";
import { useListenLaterStore } from "../listenLaterStore";
import type { Document } from "../../types/document";

vi.mock("../../api/audioEditions", () => ({
  getAudioEditionByDocument: vi.fn(async () => null),
  createAudioEdition: vi.fn(async (ed, secs) => ({ ...ed, sections: secs })),
}));

vi.mock("../audioEditionGenerationStore", () => ({
  useAudioEditionGenerationStore: {
    getState: () => ({
      startJob: vi.fn(async () => {}),
    }),
  },
}));

describe("Listen Later Queue Store", () => {
  beforeEach(() => {
    useListenLaterStore.setState({
      queue: [],
      currentIndex: 0,
      isPlaying: false,
      schedulerMode: "lazy",
    });
  });

  const dummyDoc = {
    id: "doc-queue-1",
    title: "Understanding Special Relativity",
    fileType: "html",
    filePath: "/tmp/relativity.html",
    content: "Einstein published on special relativity in 1905.",
    contentHash: "hash-rel",
    dateAdded: new Date().toISOString(),
    progressPercent: 0,
    tags: ["physics"],
  } as unknown as Document;

  it("adds items to the queue and computes estimated duration", async () => {
    const store = useListenLaterStore.getState();
    await store.addItem(dummyDoc);

    const updated = useListenLaterStore.getState().queue;
    expect(updated.length).toBe(1);
    expect(updated[0].title).toBe("Understanding Special Relativity");
    expect(updated[0].characterCount).toBe(dummyDoc.content?.length);
    expect(updated[0].durationSec).toBeGreaterThan(0);
  });

  it("advances and navigates tracks in playlist", async () => {
    const store = useListenLaterStore.getState();
    await store.addItem(dummyDoc);
    await store.addItem({
      ...dummyDoc,
      id: "doc-queue-2",
      title: "General Relativity and Gravity",
    });

    expect(useListenLaterStore.getState().queue.length).toBe(2);
    expect(useListenLaterStore.getState().currentIndex).toBe(0);

    useListenLaterStore.getState().nextTrack();
    expect(useListenLaterStore.getState().currentIndex).toBe(1);

    useListenLaterStore.getState().prevTrack();
    expect(useListenLaterStore.getState().currentIndex).toBe(0);
  });

  it("reorders queue items correctly", async () => {
    const store = useListenLaterStore.getState();
    await store.addItem(dummyDoc);
    await store.addItem({
      ...dummyDoc,
      id: "doc-queue-2",
      title: "Second Item",
    });

    store.reorderQueue(0, 1);
    const updated = useListenLaterStore.getState().queue;
    expect(updated[0].title).toBe("Second Item");
    expect(updated[1].title).toBe("Understanding Special Relativity");
  });
});
