import { beforeEach, expect, it, vi } from "vitest";
import { describeAudioSource, touchEditionWorkingSet } from "../audioSourceResolver";
import {
  SECTION_AUDIO_CACHE_MAX_ENTRIES,
  revokeSectionAudioUrls,
  sectionAudioBlobCache,
  setSectionAudioUrl,
} from "../../../stores/audioEditionGenerationStore";

const catalog = vi.hoisted(() => ({
  document: vi.fn(),
  documents: vi.fn(),
  position: vi.fn(),
  edition: vi.fn(),
  editionById: vi.fn(),
  sections: vi.fn(),
  editionPosition: vi.fn(),
  episodes: vi.fn(),
  downloadedEpisodePath: vi.fn(),
  recordingSession: vi.fn(),
  recordingAsset: vi.fn(),
  recordingMediaPath: vi.fn(),
}));
vi.mock("../../../api/documents", () => ({
  getDocument: catalog.document,
  getDocuments: catalog.documents,
}));
vi.mock("../../../api/position", () => ({ getDocumentPosition: catalog.position }));
vi.mock("../../../api/audioEditions", () => ({
  getAudioEditionByDocument: catalog.edition,
  getAudioEdition: catalog.editionById,
  getAudioEditionSections: catalog.sections,
}));
vi.mock("../../../utils/audioEditionPosition", () => ({
  getAudioEditionPosition: catalog.editionPosition,
}));
vi.mock("../../../api/podcast", () => ({
  getPodcastEpisodes: catalog.episodes,
  getDownloadedEpisodePath: catalog.downloadedEpisodePath,
}));
vi.mock("../../../api/recordingSessions", () => ({
  getRecordingSession: catalog.recordingSession,
  getRecordingAsset: catalog.recordingAsset,
  getRecordingMediaPath: catalog.recordingMediaPath,
}));

beforeEach(() => {
  localStorage.clear();
  revokeSectionAudioUrls([...sectionAudioBlobCache.keys()]);
  catalog.document.mockResolvedValue({ id: "book", title: "Book", fileType: "audio", filePath: "/original.m4b", contentHash: "document-v1" });
  catalog.documents.mockResolvedValue([]);
  catalog.position.mockResolvedValue({ type: "time", seconds: 125 });
  catalog.edition.mockResolvedValue({ id: "imported", provider: "imported", sourceRevisionHash: "import-v2" });
  catalog.editionById.mockResolvedValue({ id: "ed-1", provider: "pocket", status: "ready", sourceDocumentId: "doc-text", sourceRevisionHash: "ed-hash-1" });
  catalog.editionPosition.mockResolvedValue(null);
  catalog.sections.mockResolvedValue([
    { id: "part-2", sectionIndex: 1, generationStatus: "ready", audioFilePath: "/second.m4a", durationSec: 90, cacheKey: "second-v2", title: "Two" },
    { id: "part-1", sectionIndex: 0, generationStatus: "ready", audioFilePath: "/first.m4a", durationSec: 120, cacheKey: "first-v2", title: "One" },
  ]);
  catalog.episodes.mockResolvedValue([]);
  catalog.downloadedEpisodePath.mockResolvedValue(null);
  catalog.recordingSession.mockResolvedValue({ id: "rec-1", documentId: "doc-notes", mediaAssetId: "asset-1" });
  catalog.recordingAsset.mockResolvedValue({ id: "asset-1", state: "ready", sha256: "sha-1", durationMs: 45_000 });
  catalog.recordingMediaPath.mockResolvedValue("/managed/recordings/rec-1.webm");
});

it("recovers persisted imported parts in order without legacy browser metadata", async () => {
  const source = await describeAudioSource({ profileKey: "local", sourceId: "book", kind: "audiobook" });
  expect(source).toMatchObject({ mediaRevision: "import-v2", resumeGlobalSec: 125, documentId: "book" });
  expect(source.parts.map(part => part.path)).toEqual(["/first.m4a", "/second.m4a"]);
});

it("does not silently substitute the original file when an imported part is missing", async () => {
  catalog.sections.mockResolvedValue([{ id: "missing", sectionIndex: 0, generationStatus: "failed", audioFilePath: null }]);
  await expect(describeAudioSource({ profileKey: "local", sourceId: "book", kind: "audiobook" })).rejects.toThrow("parts are unavailable");
});

it("still reads legacy multipart metadata when there is no persisted imported edition", async () => {
  catalog.edition.mockResolvedValue(null);
  localStorage.setItem("audiobook-book", JSON.stringify({ multiPart: { partFiles: ["/old-1.mp3", "/old-2.mp3"], partDurations: [80, 100] } }));
  const source = await describeAudioSource({ profileKey: "local", sourceId: "book", kind: "audiobook" });
  expect(source.parts.map(part => part.path)).toEqual(["/old-1.mp3", "/old-2.mp3"]);
});

it("resolves podcasts with local download priority, remote fallback, and verified promoted document ID only", async () => {
  catalog.episodes.mockResolvedValue([
    { id: "ep-1", title: "Episode 1", audioUrl: "https://cdn.example/ep1.mp3", guid: "guid-1", duration: 600, playbackPosition: 42, imageUrl: "https://cdn.example/art.jpg" },
  ]);
  catalog.downloadedEpisodePath.mockResolvedValue("/managed/podcasts/ep-1.mp3");
  catalog.documents.mockResolvedValue([
    { id: "ep-1", fileType: "epub", metadata: { source: "podcast:ep-1" } },
    { id: "doc-promoted", fileType: "audio", metadata: { source: "podcast:ep-1" } },
  ]);
  const promoted = await describeAudioSource({ profileKey: "local", sourceId: "ep-1", kind: "podcast" });
  expect(promoted).toMatchObject({
    title: "Episode 1",
    documentId: "doc-promoted",
    resumeGlobalSec: 42,
    parts: [{ id: "ep-1", path: "/managed/podcasts/ep-1.mp3", fallbackPath: "https://cdn.example/ep1.mp3", durationSec: 600 }],
  });

  catalog.documents.mockResolvedValue([]);
  catalog.downloadedEpisodePath.mockRejectedValueOnce(new Error("fs unavailable"));
  const standalone = await describeAudioSource({ profileKey: "local", sourceId: "ep-1", kind: "podcast" });
  expect(standalone.documentId).toBeUndefined();
  expect(standalone.parts[0].path).toBe("https://cdn.example/ep1.mp3");
});

it("resolves ready recordings via getRecordingMediaPath and rejects partial or transcript-only sessions", async () => {
  catalog.document.mockResolvedValue({ id: "doc-notes", title: "Lecture Notes", fileType: "markdown" });
  const ready = await describeAudioSource({ profileKey: "local", sourceId: "rec-1", kind: "recording" });
  expect(ready).toMatchObject({
    title: "Lecture Notes",
    documentId: "doc-notes",
    mediaRevision: "sha-1",
    parts: [{ id: "asset-1", path: "/managed/recordings/rec-1.webm", durationSec: 45 }],
  });

  catalog.recordingAsset.mockResolvedValueOnce({ id: "asset-1", state: "partial", sha256: null, durationMs: null });
  await expect(describeAudioSource({ profileKey: "local", sourceId: "rec-1", kind: "recording" })).rejects.toMatchObject({
    code: "source_missing",
    message: "Recording is unfinished",
  });

  catalog.recordingSession.mockResolvedValueOnce({ id: "rec-1", documentId: "doc-notes", mediaAssetId: null });
  await expect(describeAudioSource({ profileKey: "local", sourceId: "rec-1", kind: "recording" })).rejects.toMatchObject({
    code: "source_missing",
    message: "Transcript-only session",
  });
});

it("prefers live sectionAudioBlobCache URLs, stops at unprepared gaps, and keeps the 24-section LRU bounded", async () => {
  catalog.document.mockResolvedValue({ id: "doc-text", title: "Synthesized Book", fileType: "epub" });
  const totalSections = SECTION_AUDIO_CACHE_MAX_ENTRIES + 8;
  for (let i = 0; i < totalSections; i++) {
    setSectionAudioUrl(`sec-${i}`, `blob:live-${i}`, 512);
  }
  expect(sectionAudioBlobCache.size).toBe(SECTION_AUDIO_CACHE_MAX_ENTRIES);

  catalog.sections.mockResolvedValue(
    Array.from({ length: totalSections }, (_, i) => ({
      id: `sec-${i}`,
      sectionIndex: i,
      generationStatus: i === totalSections - 2 ? "pending" : "ready",
      audioFilePath: `/staged/sec-${i}.wav`,
      durationSec: 30,
      cacheKey: `cache-${i}`,
      title: `Chapter ${i + 1}`,
    })),
  );
  catalog.editionPosition.mockResolvedValue({ partIndex: 10, timeInPart: 7, globalTimeSec: 307 });

  const edition = await describeAudioSource({ profileKey: "local", sourceId: "ed-1", kind: "audio_edition" });
  // Stops strictly before the pending section at totalSections - 2
  expect(edition.parts).toHaveLength(totalSections - 2);
  expect(edition.complete).toBe(false);
  // Evicted early sections fall back to staged path; live LRU entries use blob URLs
  expect(edition.parts[0].path).toBe("/staged/sec-0.wav");
  expect(edition.parts[10].path).toBe("blob:live-10");
  expect(sectionAudioBlobCache.size).toBeLessThanOrEqual(SECTION_AUDIO_CACHE_MAX_ENTRIES);

  // Touching working set updates browserUrl when cache entry is refreshed on retry
  setSectionAudioUrl("sec-10", "blob:retried-10", 512);
  const refreshed = await touchEditionWorkingSet(
    {
      sourceKey: { profileKey: "local", sourceId: "ed-1", kind: "audio_edition" },
      title: edition.title,
      mediaRevision: edition.mediaRevision,
      complete: false,
      parts: edition.parts.map((part, idx) => ({
        partId: part.id,
        sourceRevision: part.revision,
        browserUrl: part.path,
        durationSec: part.durationSec,
        globalStartSec: idx * 30,
      })),
    },
    10,
  );
  expect(refreshed.parts[10].browserUrl).toBe("blob:retried-10");
});
