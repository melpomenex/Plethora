import { describe, expect, it } from "vitest";
import {
  buildCanonicalStatusUrl,
  extractXScreenName,
  extractXStatusId,
  isXStatusUrl,
} from "../xthreadUrl";

describe("xthreadUrl — X status URL normalization", () => {
  it("extracts status ids across www/mobile subdomains, hosts, and schemes", () => {
    const cases: Array<[string, string]> = [
      ["https://x.com/user/status/1234567890", "1234567890"],
      ["https://www.x.com/user/status/1234567890", "1234567890"],
      ["http://mobile.twitter.com/user/status/9876543210", "9876543210"],
      ["https://twitter.com/Some_User/status/987?s=20&t=abc", "987"],
      ["mobile.x.com/Some_User/status/5555", "5555"],
      ["x.com/u/status/42", "42"],
    ];
    for (const [url, expected] of cases) {
      expect(extractXStatusId(url)).toBe(expected);
    }
  });

  it("handles /i/status/, trailing slashes, query strings, and photo suffixes", () => {
    expect(extractXStatusId("https://x.com/i/status/111222333")).toBe("111222333");
    expect(extractXStatusId("https://x.com/u/status/42/")).toBe("42");
    expect(extractXStatusId("https://x.com/u/status/42/?s=20")).toBe("42");
    expect(extractXStatusId("https://x.com/u/status/42/photo/1")).toBe("42");
    expect(extractXStatusId("https://x.com/u/STATUS/99")).toBe("99");
    expect(extractXStatusId("https://x.com/u/status/42#frag")).toBe("42");
  });

  it("rejects non-X hosts and malformed ids", () => {
    for (const bad of [
      "https://x.com/user",
      "https://x.com/user/status",
      "https://x.com/u/status/abc",
      "https://x.com/i/status/",
      "https://example.com/status/123",
      "example.com/user/status/123",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(extractXStatusId(bad)).toBeNull();
    }
  });

  it("extracts screen names only from URLs carrying a real handle", () => {
    expect(extractXScreenName("https://x.com/janeresearch/status/1001?s=20")).toBe("janeresearch");
    expect(extractXScreenName("http://mobile.twitter.com/Some_User/status/42")).toBe("Some_User");
    expect(extractXScreenName("https://www.x.com/Handle/status/1/")).toBe("Handle");
    expect(extractXScreenName("https://x.com/i/status/42")).toBeNull();
    expect(extractXScreenName("https://x.com/status/42")).toBeNull();
    expect(extractXScreenName("not a url")).toBeNull();
  });

  it("builds the canonical status URL and classifies status links", () => {
    expect(buildCanonicalStatusUrl("janeresearch", "1001")).toBe(
      "https://x.com/janeresearch/status/1001"
    );
    expect(isXStatusUrl("https://twitter.com/u/status/123")).toBe(true);
    expect(isXStatusUrl("https://example.com/status/123")).toBe(false);
  });
});
