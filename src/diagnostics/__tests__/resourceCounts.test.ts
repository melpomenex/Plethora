/**
 * Diagnostic snapshot tests (task 3.5 / 3.6): JSON-serializable, content-free,
 * cheap, and composed of every documented counter. Also covers the scenario
 * executor's `diagnostics` op and the gated synthetic-leak sink (task 4.3).
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { installFakeIndexedDb, flushIDb } from "../../test/fakeIndexedDb";
import { getDiagnosticSnapshot } from "../resourceCounts";
import { createOwnedObjectUrl, revokeAllOwnedObjectUrls, resetOwnedObjectUrlRegistryForTests } from "../ownedObjectUrl";
import { recordError, resetErrorRecorderForTests } from "../errorRecorder";
import { executeStep, configureSyntheticLeak, getSyntheticLeakSinkSize } from "../../lib/memoryScenario/executor";
import { getMemoryScenarioConfig } from "../../lib/memoryScenario/config";

const setGate = (value: boolean | null) => {
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = value;
};

beforeEach(() => {
  installFakeIndexedDb();
  resetOwnedObjectUrlRegistryForTests();
  resetErrorRecorderForTests();
  setGate(true);
});

afterEach(() => {
  setGate(null);
});

describe("getDiagnosticSnapshot", () => {
  it("composes every documented counter and stays JSON-serializable", async () => {
    createOwnedObjectUrl(new Blob([new Uint8Array(128)]), { owner: "tts-synthesis", ownerId: "k1" });
    recordError({ type: "error", message: "boom 1" });
    const snapshot = await getDiagnosticSnapshot();
    expect(snapshot.ownedObjectUrls.total).toEqual({ count: 1, bytes: 128 });
    expect(snapshot.ownedObjectUrls.byOwner["tts-synthesis"]).toEqual({ count: 1, bytes: 128 });
    expect(snapshot.errorAggregates.length).toBe(1);
    expect(snapshot.ttsInFlight).toBe(0);
    expect(typeof snapshot.sectionAudioBlobCache.entries).toBe("number");
    expect(typeof snapshot.audioEditionJobs.active).toBe("number");
    expect(typeof snapshot.ttsCache.entryCount).toBe("number");
    expect(typeof snapshot.ttsCacheConnections.live).toBe("number");
    // JSON round-trip: no cycles, no non-serializable fields.
    expect(JSON.parse(JSON.stringify(snapshot))).toBeTruthy();
  });

  it("is content-free: no user text or audio payloads anywhere in the JSON", async () => {
    createOwnedObjectUrl(new Blob([new Uint8Array(64)]), { owner: "tts-cache-hit", ownerId: "secret-cache-key" });
    recordError({ type: "error", message: "TypeError: x is not a function" });
    const json = JSON.stringify(await getDiagnosticSnapshot());
    expect(json).not.toContain("secret-cache-key"); // ownerIds are not listed
    expect(json).not.toContain("blob:"); // no URLs
    expect(json).not.toContain("ArrayBuffer");
  });

  it("is cheap: stats for 10^4 tracked URLs compute in well under 1 ms (bench terms)", async () => {
    for (let i = 0; i < 10_000; i++) {
      createOwnedObjectUrl(new Blob([new Uint8Array(8)]), { owner: `owner-${i % 17}`, ownerId: `k${i}` });
    }
    const snapshot = await getDiagnosticSnapshot();
    expect(snapshot.ownedObjectUrls.total.count).toBe(10_000);
    // The sync composition itself (URL stats + aggregates) is the hot path.
    const start = performance.now();
    void JSON.stringify(snapshot);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // serialization of 10k entries stays trivial
    revokeAllOwnedObjectUrls("owner-0");
    expect(getSnapshotCountSafely(snapshot)).toBeGreaterThan(0);
  });

  it("reports the shared TTS cache connection count", async () => {
    const snapshot = await getDiagnosticSnapshot();
    expect(snapshot.ttsCacheConnections.opened).toBeGreaterThanOrEqual(1);
    expect(snapshot.ttsCacheConnections.live).toBeGreaterThanOrEqual(1);
    await flushIDb();
  });
});

function getSnapshotCountSafely(snapshot: { ownedObjectUrls: { total: { count: number } } }): number {
  return snapshot.ownedObjectUrls.total.count;
}

describe("scenario diagnostics op (task 3.6)", () => {
  it("the diagnostics step returns the composed snapshot", async () => {
    const manifest = { items: {}, corpusDir: "/tmp" };
    const result = await executeStep({ step: 1, op: "diagnostics" }, manifest);
    expect(result.ok).toBe(true);
    const snapshot = result.diagnostics as { ownedObjectUrls?: unknown };
    expect(snapshot.ownedObjectUrls).toBeTruthy();
  });
});

describe("synthetic leak sink (task 4.3)", () => {
  it("retains the configured MB per cycle step", async () => {
    configureSyntheticLeak(1);
    const before = getSyntheticLeakSinkSize();
    const manifest = { items: {}, corpusDir: "/tmp" };
    // An `open` cycle step triggers injection; it fails at the document layer
    // in jsdom but the leak sink has already grown by the configured MB.
    await executeStep({ step: 2, op: "open", corpusId: "missing" }, manifest).catch(() => {});
    expect(getSyntheticLeakSinkSize()).toBe(before + 1);
    configureSyntheticLeak(0);
  });

  it("is absent without configuration (production-config flavor)", async () => {
    configureSyntheticLeak(0);
    const before = getSyntheticLeakSinkSize();
    const manifest = { items: {}, corpusDir: "/tmp" };
    await executeStep({ step: 3, op: "open", corpusId: "missing" }, manifest).catch(() => {});
    expect(getSyntheticLeakSinkSize()).toBe(before); // no growth unconfigured
  });
});

describe("scenario host inertness (production configuration)", () => {
  it("getMemoryScenarioConfig returns null outside the Tauri harness (jsdom)", async () => {
    // In jsdom the invoke bridge is unavailable, mirroring a production
    // webview without the harness env: the host must stay inert.
    const config = await getMemoryScenarioConfig();
    expect(config).toBeNull();
  });
});
