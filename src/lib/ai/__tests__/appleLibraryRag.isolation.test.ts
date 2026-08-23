import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Ask Library isolation", () => {
  it("does not import help retrieval from the library task", () => {
    const src = readFileSync("src/lib/ai/tasks/definitions/libraryTask.ts", "utf8");
    expect(src).not.toMatch(/helpRetrieval/);
    expect(src).not.toMatch(/askPlethora/);
  });
});
