import { describe, expect, it } from "vitest";
import {
  CORE_AI_PACKAGE_FORMAT,
  evaluateDiskGate,
  evaluateMemoryGate,
  parseCoreAiCatalog,
  verifyCatalogBytes,
} from "../apple/coreAiCatalog";

const entry = {
  modelId: "demo",
  version: "1.0.0",
  packageFormat: CORE_AI_PACKAGE_FORMAT,
  url: "https://example.invalid/demo.aimodel",
  sha256: "abc",
  byteSize: 100,
  installSizeBytes: 200,
  minOs: "27.0",
  ramRecommendedMb: 1024,
  license: { spdx: "Apache-2.0" },
};

describe("Core AI catalog", () => {
  it("accepts a valid catalog", () => {
    expect(parseCoreAiCatalog({ version: 1, entries: [entry] }).entries).toHaveLength(1);
  });

  it("rejects unknown package formats", () => {
    expect(() =>
      parseCoreAiCatalog({ entries: [{ ...entry, packageFormat: "gguf" }] }),
    ).toThrow(/unknown_format/);
  });

  it("detects a tampered catalog digest", async () => {
    const json = JSON.stringify({ entries: [entry] });
    expect(await verifyCatalogBytes(json, "00".repeat(32))).toBe(false);
  });

  it("gates disk: allow, deny, warn, hard cap", () => {
    expect(
      evaluateDiskGate({
        byteSize: 100,
        installSizeBytes: 200,
        freeBytes: 4 * 1024 * 1024 * 1024,
      }).ok,
    ).toBe(true);
    expect(
      evaluateDiskGate({
        byteSize: 100,
        installSizeBytes: 200,
        freeBytes: 100,
      }).reason,
    ).toBe("insufficient_disk");
    expect(
      evaluateDiskGate({
        byteSize: 9 * 1024 * 1024 * 1024,
        installSizeBytes: 9 * 1024 * 1024 * 1024,
        freeBytes: 20 * 1024 * 1024 * 1024,
      }).reason,
    ).toBe("hard_cap");
    expect(
      evaluateDiskGate({
        byteSize: 100,
        installSizeBytes: 2 * 1024 * 1024 * 1024,
        freeBytes: 8 * 1024 * 1024 * 1024,
        iphone: true,
      }).reason,
    ).toBe("iphone_large_warn");
  });

  it("refuses models above the memory budget", () => {
    expect(evaluateMemoryGate(8192, 4096)).toEqual({
      ok: false,
      reason: "insufficient_memory",
    });
  });
});
