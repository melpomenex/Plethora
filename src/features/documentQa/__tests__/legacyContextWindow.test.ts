import { describe, expect, it } from "vitest";
import { isVideoDocumentFileType, truncateLegacyQaContext } from "../legacyContextWindow";

describe("legacy Document Q&A context truncation", () => {
  it("never head-slices a video transcript, however long", () => {
    const tail = "CLOSING_SENTINEL the final remark of the video.";
    const transcript = Array.from({ length: 4000 }, (_, i) => `[${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}] spoken line ${i}`);
    transcript.push(tail);
    const content = transcript.join("\n");

    const result = truncateLegacyQaContext(content, 4000, true);

    expect(result).toBe(content);
    expect(result).toContain(tail);
    expect(result).not.toContain("[Content truncated");
  });

  it("still bounds non-video documents with the legacy marker", () => {
    const content = "head\n" + "x".repeat(20000);

    const result = truncateLegacyQaContext(content, 1000, false);

    expect(result.length).toBeLessThan(content.length);
    expect(result.endsWith("[Content truncated due to length...]")).toBe(true);
  });

  it("leaves short non-video text untouched", () => {
    expect(truncateLegacyQaContext("short text", 1000, false)).toBe("short text");
  });

  it("recognizes both video document file types", () => {
    expect(isVideoDocumentFileType("youtube")).toBe(true);
    expect(isVideoDocumentFileType("video")).toBe(true);
    expect(isVideoDocumentFileType("pdf")).toBe(false);
    expect(isVideoDocumentFileType(undefined)).toBe(false);
  });
});
