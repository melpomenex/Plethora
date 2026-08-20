import { MemoryLanguageProcessingStore } from "../persistence";
import { baselineAdapter } from "../baseline";

describe("language processing durable-store contract", () => {
  it("pages token streams without requiring a full reactive result", async () => {
    const store = new MemoryLanguageProcessingStore();
    const chunk = await baselineAdapter.analyze({ text: "one two three", languageTag: "en" });
    await store.putChunk(chunk.version.processingKey, chunk);
    await store.putResult({
      processingKey: chunk.version.processingKey,
      version: chunk.version,
      chunkCount: 1,
      summary: chunk.summary,
      updatedAt: 10,
    });
    const page = await store.pageTokens(chunk.version.processingKey, 1, 1);
    expect(page).toMatchObject({ offset: 1, limit: 1, total: 3, hasMore: true });
    expect(page?.tokens[0].surface).toBe("two");
  });
});
