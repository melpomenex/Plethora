import { describe, expect, it, vi } from "vitest";
import fixtureJson from "../generated/marketing-fixture-v2.json";
import { commitMarketingCaptureFixture, type MarketingCapturePersistencePort } from "../adapterCore";
import { marketingCaptureParams, resolveMarketingCaptureRequest } from "../capability";
import { isMarketingCaptureNamespace, marketingCaptureNamespace } from "../namespace";
import { deleteCaptureDatabase } from "../browserAdapter";
import type { MarketingCompiledFixture } from "../types";

const fixture = fixtureJson as unknown as MarketingCompiledFixture;

function memoryPort() {
  let counts = { documents: 0, extracts: 0, learningItems: 0, files: 0, queue: 0 };
  const replace = vi.fn<MarketingCapturePersistencePort<string>["replace"]>(async (records) => {
    counts = {
      documents: records.documents.length,
      extracts: records.extracts.length,
      learningItems: records.learningItems.length,
      files: records.files.length,
      queue: records.auxiliary.queue.length,
    };
  });
  return {
    port: { replace, readCounts: async () => ({ ...counts }) },
    replace,
  };
}

describe("marketing capture adapter core", () => {
  it("replaces idempotently and returns complete product-query counts", async () => {
    const { port, replace } = memoryPort();
    const decodedFiles = fixture.records.files.map((file) => file.id);
    const first = await commitMarketingCaptureFixture(fixture, decodedFiles, port);
    const second = await commitMarketingCaptureFixture(fixture, decodedFiles, port);
    expect(first).toEqual({ documents: 5, extracts: 3, learningItems: 5, files: 5, queue: 5 });
    expect(second).toEqual(first);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("propagates a repository migration/transaction failure", async () => {
    const port: MarketingCapturePersistencePort<string> = {
      replace: async () => { throw new Error("schema migration unavailable"); },
      readCounts: async () => ({ documents: 0, extracts: 0, learningItems: 0, files: 0, queue: 0 }),
    };
    await expect(commitMarketingCaptureFixture(fixture, fixture.records.files.map((file) => file.id), port))
      .rejects.toThrow("schema migration unavailable");
  });

  it("fails closed when a normal app query is incomplete", async () => {
    const { port } = memoryPort();
    port.readCounts = async () => ({ documents: 4, extracts: 3, learningItems: 5, files: 5, queue: 5 });
    await expect(commitMarketingCaptureFixture(fixture, fixture.records.files.map((file) => file.id), port))
      .rejects.toThrow("query mismatch for documents");
  });
});

describe("capture capability and isolation", () => {
  it("parses hash-router parameters but ignores query intent in production", () => {
    const location = { search: "", hash: "#/?fixture=marketing-fixture-v2&scene=library.ready&layout=desktop" };
    expect(marketingCaptureParams(location).get("scene")).toBe("library.ready");
    expect(resolveMarketingCaptureRequest(location, { DEV: false })).toBeNull();
    expect(resolveMarketingCaptureRequest(location, { DEV: true })?.sceneId).toBe("library.ready");
  });

  it("rejects unknown scenes in an enabled capture build", () => {
    const location = { search: "?fixture=marketing-fixture-v2&scene=not-real&layout=desktop", hash: "" };
    expect(() => resolveMarketingCaptureRequest(location, { DEV: true })).toThrow("Unknown marketing scene");
  });

  it("derives a narrow namespace and refuses to delete the normal database", async () => {
    const name = marketingCaptureNamespace(fixture.metadata.fixtureHash);
    expect(isMarketingCaptureNamespace(name)).toBe(true);
    expect(isMarketingCaptureNamespace("plethora")).toBe(false);
    let deleteCalls = 0;
    const factory = {
      deleteDatabase: () => {
        deleteCalls += 1;
        return {} as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    await expect(deleteCaptureDatabase("plethora", factory)).rejects.toThrow("non-capture");
    expect(deleteCalls).toBe(0);
  });
});
