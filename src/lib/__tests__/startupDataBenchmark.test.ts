import { describe, expect, it } from "vitest";
import { createEmptyStartupFixture, createStartupFixture } from "../sync/startupFixture";
import { runStartupDataBenchmark } from "../sync/startupDataBenchmark";

describe("startup data benchmark fixture", () => {
  it("creates the deterministic large local-data profile", () => {
    const fixture = createStartupFixture();
    expect(fixture.documents).toHaveLength(1000);
    expect(fixture.learningItems).toHaveLength(5000);
    expect(fixture.documents[0]?.id).toBe("doc-0000");
    expect(fixture.learningItems[4999]?.documentId).toBe("doc-0999");
  });

  it("covers an empty database and measures only the bounded response", async () => {
    const fixture = createEmptyStartupFixture();
    const result = await runStartupDataBenchmark({
      fixture,
      profile: "boox-palma-2",
      iterations: 1,
      load: async (input) => ({
        documents: input.documents.slice(0, 50).map(({ content: _content, metadata: _metadata, ...summary }) => summary),
        queue: input.learningItems.slice(0, 50),
      }),
    });
    expect(result.documentCount).toBe(0);
    expect(result.learningItemCount).toBe(0);
    expect(result.passes).toBe(true);
  });

  it("keeps the large fixture response bounded to startup-sized pages", async () => {
    const fixture = createStartupFixture();
    const result = await runStartupDataBenchmark({
      fixture,
      profile: "desktop",
      iterations: 5,
      load: async (input) => ({
        documents: input.documents.slice(0, 50).map(({ content: _content, metadata: _metadata, ...summary }) => summary),
        queue: input.learningItems.slice(0, 50),
      }),
    });
    expect(result.documentCount).toBe(1000);
    expect(result.learningItemCount).toBe(5000);
    expect(result.serializedBytes).toBeLessThan(256 * 1024);
    expect(result.passes).toBe(true);
  });

  it("meets the Palma 2 budget for the same large fixture", async () => {
    const fixture = createStartupFixture();
    const result = await runStartupDataBenchmark({
      fixture,
      profile: "boox-palma-2",
      iterations: 5,
      load: async (input) => ({
        documents: input.documents.slice(0, 50).map(({ content: _content, metadata: _metadata, ...summary }) => summary),
        queue: input.learningItems.slice(0, 50),
      }),
    });
    expect(result.serializedBytes).toBeLessThan(256 * 1024);
    expect(result.passes).toBe(true);
  });
});
