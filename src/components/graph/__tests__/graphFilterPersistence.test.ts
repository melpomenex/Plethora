import { describe, expect, it } from "vitest";
import {
  GRAPH_FILTER_SIDEBAR_STORAGE_KEY,
  defaultGraphFilterSidebarOpen,
  readGraphFilterSidebarOpen,
  writeGraphFilterSidebarOpen,
} from "../graphFilterPersistence";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(GRAPH_FILTER_SIDEBAR_STORAGE_KEY, initial);
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("graph filter sidebar persistence", () => {
  it("defaults to open on desktop and collapsed elsewhere", () => {
    expect(defaultGraphFilterSidebarOpen("desktop")).toBe(true);
    expect(defaultGraphFilterSidebarOpen("compact-desktop")).toBe(false);
    expect(defaultGraphFilterSidebarOpen("phone")).toBe(false);
    expect(defaultGraphFilterSidebarOpen("tablet")).toBe(false);
  });

  it("falls back to the mode default when the key is missing", () => {
    const storage = memoryStorage();
    expect(readGraphFilterSidebarOpen("desktop", storage)).toBe(true);
    expect(readGraphFilterSidebarOpen("compact-desktop", storage)).toBe(false);
  });

  it("falls back safely when the value is malformed", () => {
    expect(readGraphFilterSidebarOpen("desktop", memoryStorage("{not json"))).toBe(true);
    expect(readGraphFilterSidebarOpen("compact-desktop", memoryStorage("[]"))).toBe(false);
    expect(readGraphFilterSidebarOpen("desktop", memoryStorage("null"))).toBe(true);
  });

  it("reads the persisted state for the requested presentation mode", () => {
    const storage = memoryStorage(
      JSON.stringify({ desktop: false, "compact-desktop": true }),
    );
    expect(readGraphFilterSidebarOpen("desktop", storage)).toBe(false);
    expect(readGraphFilterSidebarOpen("compact-desktop", storage)).toBe(true);
    expect(readGraphFilterSidebarOpen("phone", storage)).toBe(false);
  });

  it("writes one mode without dropping the others", () => {
    const storage = memoryStorage(JSON.stringify({ desktop: false }));
    writeGraphFilterSidebarOpen("compact-desktop", true, storage);

    expect(JSON.parse(storage.getItem(GRAPH_FILTER_SIDEBAR_STORAGE_KEY)!)).toEqual({
      desktop: false,
      "compact-desktop": true,
    });
  });

  it("does not throw when storage is unavailable or rejects writes", () => {
    const throwing = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readGraphFilterSidebarOpen("desktop", throwing)).toBe(true);
    expect(() => writeGraphFilterSidebarOpen("desktop", false, throwing)).not.toThrow();
    expect(readGraphFilterSidebarOpen("desktop", null)).toBe(true);
  });
});
