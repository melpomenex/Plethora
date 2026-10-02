import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  clearAudioEditionPosition,
  getAudioEditionPosition,
  getAudioEditionPositionSync,
  getAudioEditionProgress,
  resetAudioEditionPositionState,
  saveAudioEditionPosition,
  writeAudioEditionPositionSync,
  type AudioEditionPosition,
} from "../audioEditionPosition";

function makePosition(overrides: Partial<AudioEditionPosition> = {}): AudioEditionPosition {
  return {
    editionId: "edition-123",
    documentId: "doc-456",
    partIndex: 1, // Part 2
    timeInPart: 150.5,
    globalTimeSec: 450.5,
    totalDurationSec: 900,
    updatedAt: 1000,
    ...overrides,
  };
}

function mockIndexedDB(records: Map<string, AudioEditionPosition>): void {
  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: null, error: null };
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: vi.fn(),
        transaction: () => {
          const tx: any = {
            oncomplete: null,
            onerror: null,
            objectStore: () => ({
              get: (id: string) => {
                const getReq: any = {
                  result: records.get(id) ? { id, value: records.get(id) } : undefined,
                };
                queueMicrotask(() => getReq.onsuccess?.());
                return getReq;
              },
              put: ({ id, value }: { id: string; value: AudioEditionPosition }) => {
                records.set(id, value);
                queueMicrotask(() => tx.oncomplete?.());
              },
              delete: (id: string) => {
                records.delete(id);
                queueMicrotask(() => tx.oncomplete?.());
              },
            }),
          };
          return tx;
        },
      };
      req.result = db;
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

describe("audioEditionPosition persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAudioEditionPositionState();
  });

  afterEach(() => {
    localStorage.clear();
    delete (globalThis as any).indexedDB;
  });

  it("saves synchronously and retrieves via getAudioEditionPositionSync", () => {
    const pos = makePosition();
    writeAudioEditionPositionSync(pos);

    const fromEdition = getAudioEditionPositionSync("edition-123");
    expect(fromEdition).toEqual(pos);

    const fromDoc = getAudioEditionPositionSync(undefined, "doc-456");
    expect(fromDoc).toEqual(pos);
  });

  it("saves with flushNow=true and loads from IndexedDB", async () => {
    const records = new Map<string, AudioEditionPosition>();
    mockIndexedDB(records);

    const pos = makePosition({ timeInPart: 300, globalTimeSec: 600 });
    await saveAudioEditionPosition(pos, true);

    const loaded = await getAudioEditionPosition("edition-123");
    expect(loaded?.timeInPart).toBe(300);
    expect(loaded?.globalTimeSec).toBe(600);
    expect(loaded?.partIndex).toBe(1);
  });

  it("returns freshest record between IndexedDB and localStorage", async () => {
    const records = new Map<string, AudioEditionPosition>();
    mockIndexedDB(records);

    // Older record in IDB
    records.set("edition:edition-123", makePosition({ timeInPart: 50, updatedAt: 1000 }));
    // Newer record in localStorage
    writeAudioEditionPositionSync(makePosition({ timeInPart: 100, updatedAt: 2000 }));

    const freshest = await getAudioEditionPosition("edition-123");
    expect(freshest?.timeInPart).toBe(100);
    expect(freshest?.updatedAt).toBe(2000);
  });

  it("clears position from both backends", async () => {
    const records = new Map<string, AudioEditionPosition>();
    mockIndexedDB(records);

    const pos = makePosition();
    writeAudioEditionPositionSync(pos);
    records.set("edition:edition-123", pos);

    await clearAudioEditionPosition("edition-123", "doc-456");

    expect(getAudioEditionPositionSync("edition-123")).toBeNull();
    const afterClear = await getAudioEditionPosition("edition-123");
    expect(afterClear).toBeNull();
  });
});

describe("getAudioEditionProgress", () => {
  it("computes 0% for start or null", () => {
    expect(getAudioEditionProgress(null)).toBe(0);
    expect(getAudioEditionProgress(undefined)).toBe(0);
    expect(getAudioEditionProgress({ globalTimeSec: 0, totalDurationSec: 100 })).toBe(0);
  });

  it("computes accurate percentage for mid-part listening", () => {
    // 450s out of 900s is 50%
    expect(getAudioEditionProgress({ globalTimeSec: 450, totalDurationSec: 900 })).toBe(50);
    // 250s out of 1000s is 25%
    expect(getAudioEditionProgress({ globalTimeSec: 250, totalDurationSec: 1000 })).toBe(25);
  });

  it("clamps between 0 and 100%", () => {
    expect(getAudioEditionProgress({ globalTimeSec: 1200, totalDurationSec: 1000 })).toBe(100);
    expect(getAudioEditionProgress({ globalTimeSec: -10, totalDurationSec: 1000 })).toBe(0);
  });

  it("handles 0 total duration safely without divide-by-zero", () => {
    expect(getAudioEditionProgress({ globalTimeSec: 50, totalDurationSec: 0 })).toBe(0);
    expect(getAudioEditionProgress({ globalTimeSec: NaN as any, totalDurationSec: 100 })).toBe(0);
  });
});
