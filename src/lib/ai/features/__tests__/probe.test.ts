import { beforeEach, describe, expect, it } from "vitest";
import {
  computeDependencyRevision,
  getCachedFeatureReadinessRevision,
  getFeatureDependencyContext,
  invalidateFeatureReadiness,
  mapIndexStatus,
  withProbeTimeout,
} from "../probe";
import { defaultSettings } from "../../../../stores/settingsStore";
import type { FeatureDependencyContext } from "../types";

function fakeContext(revision: string): FeatureDependencyContext {
  return {
    revision,
    checkedAt: 1,
    checking: false,
    flags: {},
    activeRecallMode: "auto",
    platform: { os: "linux", mobile: false },
    generation: { state: "available" },
    embeddings: { state: "available" },
    ocr: { state: "available" },
    index: { state: "ready", detail: { completeness: "complete" } },
    relationships: { state: "available" },
    passageAdapter: { state: "available" },
    source: { state: "available" },
    disclosure: { state: "available" },
    billing: { state: "available" },
  };
}

describe("dependency revision", () => {
  it("changes when a provider endpoint changes", () => {
    const base = computeDependencyRevision(defaultSettings, [
      { id: "p1", provider: "ollama", enabled: true, baseUrl: "http://127.0.0.1:11434" },
    ]);
    const changed = computeDependencyRevision(defaultSettings, [
      { id: "p1", provider: "ollama", enabled: true, baseUrl: "http://192.168.1.5:11434" },
    ]);
    expect(base).not.toBe(changed);
  });

  it("changes when a feature preference or embedding destination changes", () => {
    const base = computeDependencyRevision(defaultSettings, []);
    const flagChanged = computeDependencyRevision(
      {
        ...defaultSettings,
        features: { ...defaultSettings.features, aiAgent: false },
      },
      []
    );
    expect(base).not.toBe(flagChanged);

    const embeddingChanged = computeDependencyRevision(
      {
        ...defaultSettings,
        embedding: { ...defaultSettings.embedding, ollamaBaseUrl: "http://remote.example:11434" },
      },
      []
    );
    expect(base).not.toBe(embeddingChanged);
  });

  it("is stable for the same inputs", () => {
    expect(computeDependencyRevision(defaultSettings, [])).toBe(
      computeDependencyRevision(defaultSettings, [])
    );
  });

  it("does not put an API key in the revision string", () => {
    const revision = computeDependencyRevision(defaultSettings, [
      { id: "p1", provider: "openai", enabled: true, apiKey: "sk-secret-canary" },
    ]);
    expect(revision).not.toContain("sk-secret-canary");
  });
});

describe("revision-keyed probe cache", () => {
  beforeEach(() => invalidateFeatureReadiness());

  it("deduplicates concurrent probes for the same revision", async () => {
    let calls = 0;
    const build = async () => {
      calls += 1;
      return fakeContext("rev-a");
    };
    const [a, b] = await Promise.all([
      getFeatureDependencyContext("rev-a", build),
      getFeatureDependencyContext("rev-a", build),
    ]);
    expect(calls).toBe(1);
    expect(a.revision).toBe("rev-a");
    expect(b).toBe(a);
  });

  it("never returns an older snapshot for a newer revision", async () => {
    await getFeatureDependencyContext("rev-old", async () => fakeContext("rev-old"));
    const fresh = await getFeatureDependencyContext("rev-new", async () => fakeContext("rev-new"));
    expect(fresh.revision).toBe("rev-new");
    expect(getCachedFeatureReadinessRevision()).toBe("rev-new");
  });

  it("does not cache a superseded late result", async () => {
    let resolveOld: ((ctx: FeatureDependencyContext) => void) | undefined;
    const oldPromise = getFeatureDependencyContext(
      "rev-slow",
      () => new Promise<FeatureDependencyContext>((resolve) => (resolveOld = resolve))
    );
    // A newer revision completes first.
    await getFeatureDependencyContext("rev-fast", async () => fakeContext("rev-fast"));
    resolveOld?.(fakeContext("rev-slow"));
    await oldPromise;
    expect(getCachedFeatureReadinessRevision()).toBe("rev-fast");
  });
});

describe("index status mapping", () => {
  function response(aggregate: Record<string, unknown>) {
    return {
      aggregate: {
        totalDocuments: 0,
        indexedDocuments: 0,
        queuedDocuments: 0,
        indexingDocuments: 0,
        staleDocuments: 0,
        failedDocuments: 0,
        totalChunks: 0,
        totalEmbeddings: 0,
        embeddingStorageBytes: 0,
        embeddingModels: [],
        paused: false,
        pendingDocuments: 0,
        ...aggregate,
      },
      documents: [],
    } as never;
  }

  it("reports unknown without a response", () => {
    expect(mapIndexStatus(undefined).state).toBe("unknown");
  });

  it("reports indexing/paused/failed/ready honestly", () => {
    expect(mapIndexStatus(response({ totalDocuments: 4, indexedDocuments: 2, pendingDocuments: 2 })).state).toBe("indexing");
    expect(mapIndexStatus(response({ totalDocuments: 4, indexedDocuments: 2, pendingDocuments: 0, paused: true })).state).toBe("paused");
    expect(mapIndexStatus(response({ totalDocuments: 2, indexedDocuments: 0, failedDocuments: 2 })).state).toBe("failed");
    expect(mapIndexStatus(response({ totalDocuments: 2, indexedDocuments: 2 })).state).toBe("ready");
  });

  it("never claims complete completeness from a document-only aggregate", () => {
    const mapped = mapIndexStatus(response({ totalDocuments: 2, indexedDocuments: 2 }));
    expect(mapped.detail.completeness).toBe("partial");
  });
});

describe("withProbeTimeout", () => {
  it("resolves undefined instead of throwing or hanging", async () => {
    const result = await withProbeTimeout(Promise.reject(new Error("boom")), 10);
    expect(result).toBeUndefined();
  });

  it("returns a fast result", async () => {
    await expect(withProbeTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
  });
});
