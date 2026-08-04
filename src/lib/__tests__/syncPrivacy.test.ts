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

  it("allows a portable URL under a path-like key but still rejects a bare local path", () => {
    // documentReplication.ts stores portable content (YouTube URLs, fetched
    // pages, clipboard/screenshot imports) under `filePath` — the key name
    // alone must not doom every document to fail the outbox's privacy check.
    expect(isSyncPayloadSafe({ filePath: "https://youtube.com/watch?v=abc" })).toBe(true);
    expect(isSyncPayloadSafe({ filePath: "browser-fetched://example.com/page" })).toBe(true);
    expect(isSyncPayloadSafe({ filePath: "/Users/example/book.pdf" })).toBe(false);
    expect(isSyncPayloadSafe({ localPath: "C:\\Users\\example\\book.pdf" })).toBe(false);
  });
});
