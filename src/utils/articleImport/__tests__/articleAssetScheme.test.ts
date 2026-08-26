import { describe, expect, it } from "vitest";
import {
  extractArticleAssetIds,
  isArticleAssetUrl,
  parseArticleAssetUrl,
  toArticleAssetUrl,
} from "../articleAssetScheme";

describe("articleAssetScheme", () => {
  it("round-trips asset ids through plethora-asset URLs", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const url = toArticleAssetUrl(id);
    expect(url).toBe("plethora-asset://550e8400-e29b-41d4-a716-446655440000");
    expect(parseArticleAssetUrl(url)).toBe(id);
    expect(isArticleAssetUrl(url)).toBe(true);
  });

  it("extracts ids from article HTML", () => {
    const html =
      '<figure><img src="plethora-asset://abc" alt="Fig"><img src="https://remote.test/x.png"></figure>';
    expect(extractArticleAssetIds(html)).toEqual(["abc"]);
  });

  it("rejects forged schemes", () => {
    expect(parseArticleAssetUrl("javascript:alert(1)")).toBeNull();
    expect(parseArticleAssetUrl("https://evil.test/asset")).toBeNull();
  });
});
