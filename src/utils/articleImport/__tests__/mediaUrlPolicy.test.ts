import { describe, expect, it } from "vitest";
import { isBlockedMediaHost } from "../mediaUrlPolicy";

describe("mediaUrlPolicy", () => {
  it("blocks loopback and private addresses", () => {
    expect(isBlockedMediaHost("http://127.0.0.1/secret")).toBe(true);
    expect(isBlockedMediaHost("http://localhost/x")).toBe(true);
    expect(isBlockedMediaHost("http://10.0.0.5/x")).toBe(true);
    expect(isBlockedMediaHost("http://169.254.169.254/latest/meta-data")).toBe(true);
    expect(isBlockedMediaHost("http://[::1]/x")).toBe(true);
  });

  it("allows public article hosts", () => {
    expect(isBlockedMediaHost("https://arxiv.org/html/2410.07524v1/moe-routing.svg")).toBe(false);
  });
});
