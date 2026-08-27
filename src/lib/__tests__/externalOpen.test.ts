import { describe, expect, it } from "vitest";
import { externalOpenToSharedBatch, isInternallyRoutedDeepLink } from "../externalOpen";

describe("externalOpen", () => {
  it("converts file paths to a shared batch", () => {
    const batch = externalOpenToSharedBatch({
      kind: "files",
      paths: ["/tmp/book.pdf", "/tmp/notes.md"],
    });
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items[0]).toMatchObject({ type: "file", filePath: "/tmp/book.pdf" });
  });

  it("skips auth and occlusion deep links", () => {
    expect(isInternallyRoutedDeepLink("plethora://auth/callback?code=x")).toBe(true);
    expect(isInternallyRoutedDeepLink("plethora://occlusion/create?assetId=1")).toBe(true);
    expect(
      externalOpenToSharedBatch({ kind: "deepLink", url: "plethora://auth/callback" }),
    ).toBeNull();
  });

  it("passes generic deep links through as URLs", () => {
    const batch = externalOpenToSharedBatch({
      kind: "deepLink",
      url: "plethora://import?url=https%3A%2F%2Fexample.com",
    });
    expect(batch?.items[0]).toMatchObject({
      type: "url",
      url: "https://example.com/",
    });
  });
});
