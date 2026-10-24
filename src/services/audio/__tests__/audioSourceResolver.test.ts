import { describe, expect, it, vi } from "vitest";
import { describeAudioSource, resolveAudioSource, type AudioSourceResolverDependencies } from "../audioSourceResolver";

const tauriState = vi.hoisted(() => ({ isTauri: true }));
const recordingApiMocks = vi.hoisted(() => ({
  getRecordingSession: vi.fn(),
  getRecordingAsset: vi.fn(),
  getRecordingMediaPath: vi.fn(),
}));
const documentApiMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => tauriState.isTauri,
  };
});

vi.mock("../../../api/recordingSessions", () => ({
  getRecordingSession: recordingApiMocks.getRecordingSession,
  getRecordingAsset: recordingApiMocks.getRecordingAsset,
  getRecordingMediaPath: recordingApiMocks.getRecordingMediaPath,
}));

vi.mock("../../../api/documents", () => ({
  getDocument: documentApiMocks.getDocument,
}));

function deps(platform: AudioSourceResolverDependencies["platform"] = "desktop"): AudioSourceResolverDependencies {
  return { platform, describe: vi.fn(async () => ({ title: "Book", mediaRevision: "hash", complete: true, parts: [{ id: "part", path: "/managed/book.m4b", revision: "hash", durationSec: null }] })), resolvePath: vi.fn(async () => "http://127.0.0.1:1234/range/book"), prepare: vi.fn(async () => "/managed/prepared.m4a") };
}
const key = { profileKey: "test", sourceId: "book", kind: "audiobook" as const };

it("uses prepared desktop m4b and Range URLs without materializing media bytes", async () => {
  const dependencies = deps();
  const item = await resolveAudioSource(key, new AbortController().signal, dependencies);
  expect(dependencies.prepare).toHaveBeenCalledWith("/managed/book.m4b");
  expect(dependencies.resolvePath).toHaveBeenCalledWith("/managed/prepared.m4a");
  expect(item.parts[0]).toMatchObject({ browserUrl: "http://127.0.0.1:1234/range/book", durationSec: null, globalStartSec: 0 });
});

it("does not transcode iOS audio or route Android through an HTML decoder", async () => {
  const ios = deps("ios");
  await resolveAudioSource(key, new AbortController().signal, ios);
  expect(ios.prepare).not.toHaveBeenCalled();
  expect(ios.resolvePath).toHaveBeenCalledWith("/managed/book.m4b");
  const android = deps("android");
  await expect(resolveAudioSource(key, new AbortController().signal, android)).rejects.toThrow("native service");
  expect(android.describe).not.toHaveBeenCalled();
});

it("cancels stale preparation before resolving a URL and rejects empty assets", async () => {
  const dependencies = deps();
  const abort = new AbortController();
  dependencies.prepare = vi.fn(async () => { abort.abort(); return "/late.m4a"; });
  await expect(resolveAudioSource(key, abort.signal, dependencies)).rejects.toMatchObject({ name: "AbortError" });
  expect(dependencies.resolvePath).not.toHaveBeenCalled();
  dependencies.describe = vi.fn(async () => ({ title: "Transcript", mediaRevision: "hash", parts: [], complete: true }));
  await expect(resolveAudioSource(key, new AbortController().signal, dependencies)).rejects.toThrow("No ready");
});

it("uses a remote episode fallback after local failure and revokes retired browser handles", async () => {
  const dependencies = deps("browser");
  dependencies.describe = vi.fn(async () => ({ title: "Episode", mediaRevision: "hash", complete: true, parts: [{ id: "episode", path: "missing.mp3", fallbackPath: "https://example.test/episode.mp3", revision: "hash", durationSec: 30 }] }));
  dependencies.resolvePath = vi.fn().mockRejectedValueOnce(new Error("File missing"));
  const episode = await resolveAudioSource({ ...key, kind: "podcast" }, new AbortController().signal, dependencies);
  expect(episode.parts[0].browserUrl).toBe("https://example.test/episode.mp3");
  const release = vi.fn();
  dependencies.resolvePath = vi.fn(async () => ({ url: "blob:owned-handle", release }));
  const browserItem = await resolveAudioSource(key, new AbortController().signal, dependencies);
  browserItem.release!(); browserItem.release!();
  expect(release).toHaveBeenCalledTimes(1);
});

it("resolves blob: and data:audio/ URLs directly without calling resolvePath and classifies unauthorized/unsupported errors", async () => {
  const dependencies = deps("desktop");
  dependencies.describe = vi.fn(async () => ({
    title: "Synthesized Edition",
    mediaRevision: "ed-v1",
    complete: true,
    parts: [
      { id: "s1", path: "blob:http://localhost:1420/sec-1", revision: "c1", durationSec: 12 },
      { id: "s2", path: "data:audio/wav;base64,UklGRg==", revision: "c2", durationSec: 8 },
    ],
  }));
  const resolved = await resolveAudioSource({ ...key, kind: "audio_edition" }, new AbortController().signal, dependencies);
  expect(dependencies.resolvePath).not.toHaveBeenCalled();
  expect(resolved.parts.map(p => p.browserUrl)).toEqual([
    "blob:http://localhost:1420/sec-1",
    "data:audio/wav;base64,UklGRg==",
  ]);

  dependencies.describe = vi.fn(async () => ({
    title: "Unauthorized",
    mediaRevision: "hash",
    complete: true,
    parts: [{ id: "part", path: "/etc/shadow.mp3", revision: "hash", durationSec: null }],
  }));
  dependencies.resolvePath = vi.fn().mockRejectedValueOnce(new Error("Path is not authorized for media streaming"));
  await expect(resolveAudioSource(key, new AbortController().signal, dependencies)).rejects.toMatchObject({
    code: "permission_denied",
  });

  dependencies.describe = vi.fn(async () => ({
    title: "Broken M4B",
    mediaRevision: "hash",
    complete: true,
    parts: [{ id: "part", path: "/managed/broken.m4b", revision: "hash", durationSec: null }],
  }));
  dependencies.prepare = vi.fn().mockRejectedValueOnce(new Error("ffmpeg failed to remux container"));
  await expect(resolveAudioSource(key, new AbortController().signal, dependencies)).rejects.toMatchObject({
    code: "unsupported_codec",
  });
});

describe("describeAudioSource for recording sessions", () => {
  it("consolidates ready Tauri recording paths via getRecordingMediaPath and rejects missing/partial/transcript-only sessions", async () => {
    tauriState.isTauri = true;
    documentApiMocks.getDocument.mockResolvedValue({ id: "doc-rec-1", title: "Distributed Systems Lecture" });

    recordingApiMocks.getRecordingSession.mockResolvedValueOnce({
      id: "sess-transcript",
      documentId: "doc-rec-1",
      mediaAssetId: null,
    });
    await expect(
      describeAudioSource({ profileKey: "local", kind: "recording", sourceId: "sess-transcript" }),
    ).rejects.toMatchObject({ code: "source_missing" });

    recordingApiMocks.getRecordingSession.mockResolvedValueOnce({
      id: "sess-partial",
      documentId: "doc-rec-1",
      mediaAssetId: "asset-partial",
    });
    recordingApiMocks.getRecordingAsset.mockResolvedValueOnce({
      id: "asset-partial",
      state: "partial",
      durationMs: 12000,
      sha256: null,
      relativePath: "recordings/sess-partial/part-0.wav",
      sourceUrl: null,
    });
    await expect(
      describeAudioSource({ profileKey: "local", kind: "recording", sourceId: "sess-partial" }),
    ).rejects.toMatchObject({ code: "source_missing" });
    expect(recordingApiMocks.getRecordingMediaPath).not.toHaveBeenCalled();

    recordingApiMocks.getRecordingSession.mockResolvedValueOnce({
      id: "sess-ready",
      documentId: "doc-rec-1",
      mediaAssetId: "asset-ready",
    });
    recordingApiMocks.getRecordingAsset.mockResolvedValueOnce({
      id: "asset-ready",
      state: "ready",
      durationMs: 95_000,
      sha256: "sha-ready-1",
      relativePath: "recordings/sess-ready/part-000.wav",
      sourceUrl: null,
    });
    recordingApiMocks.getRecordingMediaPath.mockResolvedValueOnce("/app-data/recordings/sess-ready/consolidated.wav");

    const ready = await describeAudioSource({ profileKey: "local", kind: "recording", sourceId: "sess-ready" });
    expect(recordingApiMocks.getRecordingMediaPath).toHaveBeenCalledWith("sess-ready");
    expect(ready).toMatchObject({
      title: "Distributed Systems Lecture",
      documentId: "doc-rec-1",
      mediaRevision: "sha-ready-1",
      complete: true,
      parts: [
        {
          id: "asset-ready",
          path: "/app-data/recordings/sess-ready/consolidated.wav",
          revision: "sha-ready-1",
          durationSec: 95,
        },
      ],
    });

    tauriState.isTauri = false;
    recordingApiMocks.getRecordingSession.mockResolvedValueOnce({
      id: "sess-web",
      documentId: "doc-rec-1",
      mediaAssetId: "asset-web",
    });
    recordingApiMocks.getRecordingAsset.mockResolvedValueOnce({
      id: "asset-web",
      state: "ready",
      durationMs: 42_000,
      sha256: null,
      relativePath: "audio.wav",
      sourceUrl: "blob:http://localhost:1420/rec-web",
    });
    const webReady = await describeAudioSource({ profileKey: "local", kind: "recording", sourceId: "sess-web" });
    expect(webReady.parts[0]?.path).toBe("blob:http://localhost:1420/rec-web");
  });
});
