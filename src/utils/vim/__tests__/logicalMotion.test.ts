import { describe, expect, it } from "vitest";
import { buildLogicalRegion } from "../logicalIndex";
import { moveLogicalCursor, type LogicalMotionSource } from "../logicalMotion";

const regions = [
  buildLogicalRegion(0, ["one two three", "short"]),
  buildLogicalRegion(1, ["four five", "six seven eight"]),
];
const source: LogicalMotionSource = {
  firstRegion: 0,
  lastRegion: 1,
  region: async (index) => regions[index] ?? null,
};

describe("logical Vim motions", () => {
  it("moves words and counts across region boundaries", async () => {
    expect((await moveLogicalCursor(source, { region: 0, token: 2 }, "word-forward")).cursor).toEqual({ region: 0, token: 3 });
    expect((await moveLogicalCursor(source, { region: 0, token: 2 }, "word-forward", 2)).cursor).toEqual({ region: 1, token: 0 });
  });

  it("preserves desired visual column across short lines and regions", async () => {
    const down = await moveLogicalCursor(source, { region: 0, token: 2 }, "line-down", 1, 2);
    expect(down.cursor).toEqual({ region: 0, token: 3 });
    const across = await moveLogicalCursor(source, down.cursor, "line-down", 1, down.desiredColumn);
    expect(across.cursor).toEqual({ region: 1, token: 1 });
    expect(across.desiredColumn).toBe(2);
  });

  it("moves to paragraph and document boundaries", async () => {
    expect((await moveLogicalCursor(source, { region: 0, token: 0 }, "paragraph-forward")).cursor).toEqual({ region: 0, token: 3 });
    expect((await moveLogicalCursor(source, { region: 0, token: 0 }, "document-end")).cursor).toEqual({ region: 1, token: 4 });
    expect((await moveLogicalCursor(source, { region: 1, token: 4 }, "document-start")).cursor).toEqual({ region: 0, token: 0 });
  });
});
