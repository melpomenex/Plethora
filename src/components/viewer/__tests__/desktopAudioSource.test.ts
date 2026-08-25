/**
 * Desktop audio source tests (task 5.5): streaming is the default; the
 * whole-file fallback is bounded (backend refuses over-cap files BEFORE
 * materialization) and its blob URL is registry-owned.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { loadDesktopAudioSource } from "../desktopAudioSource";
import { getOwnedObjectUrlStats, revokeAllOwnedObjectUrls, resetOwnedObjectUrlRegistryForTests } from "../../../diagnostics/ownedObjectUrl";

let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;
let createdUrls: string[];

beforeEach(() => {
  resetOwnedObjectUrlRegistryForTests();
  createdUrls = [];
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => {
    const url = `blob:fallback-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    createdUrls = createdUrls.filter((u) => u !== url);
  }) as typeof URL.revokeObjectURL;
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = true;
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = null;
  vi.restoreAllMocks();
});

describe("loadDesktopAudioSource (5.5)", () => {
  it("requests a stream URL and never reads the file when streaming works", async () => {
    const readFile = vi.fn(async () => new Uint8Array(1024));
    const url = await loadDesktopAudioSource("/books/big.m4b", {
      getStreamUrl: async () => "http://127.0.0.1:3999/media/abc",
      readFile,
    });
    expect(url).toBe("http://127.0.0.1:3999/media/abc");
    expect(readFile).not.toHaveBeenCalled();
    expect(getOwnedObjectUrlStats().total.count).toBe(0); // nothing materialized
  });

  it("falls back to a bounded, owned blob URL when streaming is unavailable", async () => {
    const bytes = new Uint8Array(2048);
    const url = await loadDesktopAudioSource("/books/episode.mp3", {
      getStreamUrl: async () => {
        throw new Error("media server unavailable");
      },
      readFile: async () => bytes,
    });
    expect(url).toMatch(/^blob:fallback-/);
    const stats = getOwnedObjectUrlStats();
    expect(stats.total.count).toBe(1);
    expect(stats.byOwner["desktop-audio-fallback"].bytes).toBe(2048);
    // The caller's revoke releases the only materialized copy.
    revokeAllOwnedObjectUrls("desktop-audio-fallback");
    expect(getOwnedObjectUrlStats().total.count).toBe(0);
  });

  it("propagates the backend's over-cap refusal instead of materializing", async () => {
    // The real read_document_file refuses >256 MiB files server-side before
    // transferring bytes; that refusal surfaces here and NO blob is created.
    const overCap = new Error(
      "File too large to read into memory (314572800 bytes > 268435456 cap); use the streaming server instead.",
    );
    await expect(
      loadDesktopAudioSource("/books/huge.m4b", {
        getStreamUrl: async () => "",
        readFile: async () => {
          throw overCap;
        },
      }),
    ).rejects.toThrow(/too large/i);
    expect(getOwnedObjectUrlStats().total.count).toBe(0);
  });

  it("rejects empty files", async () => {
    await expect(
      loadDesktopAudioSource("/books/empty.mp3", {
        getStreamUrl: async () => "",
        readFile: async () => new Uint8Array(0),
      }),
    ).rejects.toThrow(/empty/i);
  });
});
