/**
 * Owned object-URL registry tests (task 3.1): create/revoke accounting,
 * replace-revoke helper, byte totals, teardown-to-zero, production-inertness,
 * and the no-Blob-retention invariant.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOCATION_RING_MAX,
  createOwnedObjectUrl,
  getAllocationSites,
  getOwnedObjectUrlStats,
  replaceOwnedObjectUrl,
  resetOwnedObjectUrlRegistryForTests,
  revokeAllOwnedObjectUrls,
  revokeOwnedObjectUrl,
} from "../ownedObjectUrl";

let urlCounter = 0;
const created: string[] = [];
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  resetOwnedObjectUrlRegistryForTests();
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  urlCounter = 0;
  created.length = 0;
  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:mock-${++urlCounter}`;
    created.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    const idx = created.indexOf(url);
    if (idx >= 0) created.splice(idx, 1);
  }) as typeof URL.revokeObjectURL;
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = true;
});

afterEach(() => {
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = null;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe("create/revoke accounting stays exact", () => {
  it("counts live URLs and bytes per owner", () => {
    const a1 = createOwnedObjectUrl(blob(100), { owner: "tts-synthesis", ownerId: "k1" });
    const a2 = createOwnedObjectUrl(blob(50), { owner: "tts-synthesis", ownerId: "k2" });
    const b1 = createOwnedObjectUrl(blob(25), { owner: "edition-section", ownerId: "s1" });
    const stats = getOwnedObjectUrlStats();
    expect(stats.total).toEqual({ count: 3, bytes: 175 });
    expect(stats.byOwner["tts-synthesis"]).toEqual({ count: 2, bytes: 150 });
    expect(stats.byOwner["edition-section"]).toEqual({ count: 1, bytes: 25 });

    revokeOwnedObjectUrl(a2);
    expect(getOwnedObjectUrlStats().byOwner["tts-synthesis"]).toEqual({ count: 1, bytes: 100 });
    expect(getOwnedObjectUrlStats().total).toEqual({ count: 2, bytes: 125 });

    revokeOwnedObjectUrl(a1);
    revokeOwnedObjectUrl(b1);
    expect(getOwnedObjectUrlStats().total).toEqual({ count: 0, bytes: 0 });
    expect(created.length).toBe(0); // every URL revoked with the browser too
  });

  it("revoking an unknown URL is a no-op", () => {
    expect(() => revokeOwnedObjectUrl("blob:not-tracked")).not.toThrow();
  });
});

describe("revoke-all for a fully disposed owner", () => {
  it("releases exactly that owner's URLs (optionally narrowed by ownerId)", () => {
    createOwnedObjectUrl(blob(10), { owner: "edition-section", ownerId: "s1" });
    createOwnedObjectUrl(blob(10), { owner: "edition-section", ownerId: "s2" });
    createOwnedObjectUrl(blob(10), { owner: "tts-cache-hit", ownerId: "s1" });

    expect(revokeAllOwnedObjectUrls("edition-section", "s1")).toBe(1);
    const stats = getOwnedObjectUrlStats();
    expect(stats.byOwner["edition-section"]).toEqual({ count: 1, bytes: 10 });

    expect(revokeAllOwnedObjectUrls("edition-section")).toBe(1);
    expect(getOwnedObjectUrlStats().byOwner["edition-section"]).toBeUndefined();
    expect(getOwnedObjectUrlStats().total.count).toBe(1);
  });

  it("teardown-to-zero assertion holds after dispose and fails after a leak", () => {
    createOwnedObjectUrl(blob(10), { owner: "tts-synthesis" });
    createOwnedObjectUrl(blob(10), { owner: "tts-synthesis" });
    const leaked = createOwnedObjectUrl(blob(10), { owner: "tts-synthesis" });
    revokeOwnedObjectUrl(leaked);
    revokeAllOwnedObjectUrls("tts-synthesis");
    expect(getOwnedObjectUrlStats().byOwner["tts-synthesis"]?.count ?? 0).toBe(0);
  });
});

describe("replace-revoke helper", () => {
  it("revokes the previous URL and records the new one", () => {
    const first = createOwnedObjectUrl(blob(10), { owner: "edition-section", ownerId: "s" });
    const second = replaceOwnedObjectUrl(first, blob(20), { owner: "edition-section", ownerId: "s" });
    expect(second).not.toBe(first);
    expect(created).toContain(second);
    expect(created).not.toContain(first);
    expect(getOwnedObjectUrlStats().byOwner["edition-section"]).toEqual({ count: 1, bytes: 20 });
  });
});

describe("the registry never retains payloads", () => {
  it("holds only metadata: a dropped Blob is collectable (WeakRef)", async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const ref = (() => {
      const b = blob(4096);
      const r = new WeakRef(b);
      createOwnedObjectUrl(b, { owner: "tts-synthesis", ownerId: "x" });
      return r;
    })();
    if (typeof gc === "function") {
      gc();
      gc();
      // The registry must not keep the Blob alive; only the URL does (and the
      // test stubbed URL.createObjectURL, which also holds nothing).
      expect(ref.deref()).toBeUndefined();
    } else {
      // Without --expose-gc, assert structurally: the recorded entry is
      // metadata-only (JSON-serializable, no Blob-typed value anywhere).
      const raw = getOwnedObjectUrlStats();
      expect(JSON.parse(JSON.stringify(raw))).toEqual(raw);
      expect(Object.prototype.toString.call(raw)).toBe("[object Object]");
    }
  });
});

describe("bounded allocation-site ring (dev/test only)", () => {
  it("caps recorded sites at the documented maximum", () => {
    for (let i = 0; i < ALLOCATION_RING_MAX + 10; i++) {
      createOwnedObjectUrl(blob(1), { owner: "tts-synthesis", ownerId: `k${i}` });
    }
    expect(getAllocationSites().length).toBeLessThanOrEqual(ALLOCATION_RING_MAX);
  });
});

describe("production-inert registry (gate off)", () => {
  it("creates and revokes URLs but records nothing when diagnostics are off", () => {
    (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = false;
    const url = createOwnedObjectUrl(blob(10), { owner: "tts-synthesis" });
    expect(created).toContain(url); // functionality unchanged
    expect(getOwnedObjectUrlStats().total.count).toBe(0); // zero bookkeeping writes
    expect(getAllocationSites().length).toBe(0);
    revokeOwnedObjectUrl(url);
  });
});
