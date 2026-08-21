import { describe, expect, it } from "vitest";
import { scanForForbiddenStoreArtifacts } from "../storeProfileGuard";

describe("scanForForbiddenStoreArtifacts", () => {
  it("flags dev server and loopback endpoints", () => {
    const code = `
      const api = fetch("http://localhost:3000/v1/billing");
      const ws = new WebSocket("ws://127.0.0.1:15173");
      const v6 = "http://[::1]:8080/";
    `;
    const violations = scanForForbiddenStoreArtifacts(code);
    expect(violations.length).toBeGreaterThanOrEqual(3);
    expect(violations.every((v) => /loopback/.test(v))).toBe(true);
  });

  it("flags https loopback too", () => {
    expect(scanForForbiddenStoreArtifacts(`fetch("https://localhost/x")`).length).toBe(1);
  });

  it("passes clean production code", () => {
    const code = `
      const api = fetch("https://api.plethora.app/v1/billing");
      const xmlns = "http://www.w3.org/1999/xhtml";
      const secure = "wss://sync.plethora.app";
    `;
    expect(scanForForbiddenStoreArtifacts(code)).toEqual([]);
  });

  it("reports file name and line numbers", () => {
    const violations = scanForForbiddenStoreArtifacts("a\nb\nfetch('http://localhost')", "chunk-abc.js");
    expect(violations[0]).toMatch(/^chunk-abc\.js:3: .+ \(http:\/\/localhost\)$/);
  });
});
