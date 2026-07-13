import { describe, expect, it } from "vitest";
import { isSyncPayloadSafe } from "../sync/syncPrivacy";

describe("sync privacy boundary", () => {
  it("rejects credentials and machine-specific paths", () => {
    expect(isSyncPayloadSafe({ question: "hello", answer: "world" })).toBe(true);
    expect(isSyncPayloadSafe({ apiKey: "secret" })).toBe(false);
    expect(isSyncPayloadSafe({ filePath: "/Users/example/book.pdf" })).toBe(false);
  });

  it("rejects data URLs and oversized payloads", () => {
    expect(isSyncPayloadSafe({ image: "data:image/png;base64,abc" })).toBe(false);
    expect(isSyncPayloadSafe({ body: "x".repeat(256 * 1024 + 1) })).toBe(false);
  });
});
