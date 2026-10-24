import type { AudioSourceKey, ResolvedAudioItem, ResolvedAudioPart } from "../../types/audioEdition";
import { withAudioBoundaries, locateAudioPosition } from "./audioCoordinates";
import { AudioPlaybackException, classifyAudioPlaybackError } from "./audioErrors";
import { getFiniteMediaDuration } from "../../components/viewer/localMediaSources";

const WORKING_SET_AHEAD = 2;

export interface AudioSourceDescription {
  title: string;
  artist?: string;
  artworkUrl?: string;
  documentId?: string;
  editionId?: string;
  mediaRevision: string;
  parts: readonly { id: string; path: string; fallbackPath?: string; durationSec: number | null; title?: string; revision: string }[];
  complete: boolean;
  resume?: { partIndex: number; timeInPart: number };
  resumeGlobalSec?: number;
}

export interface AudioSourceResolverDependencies {
  describe: (key: AudioSourceKey) => Promise<AudioSourceDescription>;
  resolvePath: (path: string) => Promise<string | { url: string; release: () => void }>;
  prepare: (path: string) => Promise<string>;
  platform: "desktop" | "browser" | "android" | "ios";
}

export const isDirectAudioUrl = (path: string): boolean => /^(https?:|blob:|data:audio\/)/i.test(path);

const DIRECT_AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "m4b", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff"]);
export function isDirectAudioFile(doc: { fileType?: string; filePath?: string }): boolean {
  if (doc.fileType === "audio") return true;
  const ext = doc.filePath?.split(".").pop()?.toLowerCase();
  return Boolean(ext && DIRECT_AUDIO_EXTENSIONS.has(ext));
}

async function resolvePart(part: AudioSourceDescription["parts"][number], signal: AbortSignal, deps: AudioSourceResolverDependencies, releases: (() => void)[]): Promise<Omit<ResolvedAudioPart, "globalStartSec">> {
  signal.throwIfAborted();
  let path = part.path;
  if (!isDirectAudioUrl(path) && deps.platform === "desktop" && /\.m4b$/i.test(path)) {
    try {
      path = await deps.prepare(path);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw error;
      const classified = classifyAudioPlaybackError(error);
      throw new AudioPlaybackException(classified.code === "corrupt_media" ? "unsupported_codec" : classified.code, classified.message);
    }
  }
  signal.throwIfAborted();
  let result: string | { url: string; release: () => void };
  try { result = isDirectAudioUrl(path) ? path : await deps.resolvePath(path); }
  catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    if (!part.fallbackPath || !isDirectAudioUrl(part.fallbackPath)) {
      const classified = classifyAudioPlaybackError(error);
      throw new AudioPlaybackException(classified.code, classified.message);
    }
    result = part.fallbackPath;
  }
  const browserUrl = typeof result === "string" ? result : result.url;
  if (typeof result !== "string") releases.push(result.release);
  signal.throwIfAborted();
  return { partId: part.id, sourceRevision: part.revision, browserUrl, durationSec: getFiniteMediaDuration(part.durationSec ?? NaN), title: part.title };
}

/** Source resolution never reads complete media bytes or synthesizes a recording path. */
export async function resolveAudioSource(key: AudioSourceKey, signal: AbortSignal, deps: AudioSourceResolverDependencies): Promise<ResolvedAudioItem> {
  if (!key.profileKey || !key.sourceId) throw new AudioPlaybackException("source_missing", "Audio identity unavailable");
  // Native manifests must be authorized by Rust and sent to the service, never an HTML decoder.
  if (deps.platform === "android") throw new AudioPlaybackException("unsupported_command", "Android audio requires the native service adapter");
  signal.throwIfAborted();
  const description = await deps.describe(key);
  signal.throwIfAborted();
  if (!description.parts.length) throw new AudioPlaybackException("source_missing", "No ready audio asset available");
  const parts: Omit<ResolvedAudioPart, "globalStartSec">[] = [];
  const releases: (() => void)[] = [];
  const release = () => { releases.splice(0).forEach(dispose => dispose()); };
  try {
    for (const part of description.parts) parts.push(await resolvePart(part, signal, deps, releases));
    const manifest = withAudioBoundaries(parts);
    const resume = description.resume ?? (description.resumeGlobalSec !== undefined ? locateAudioPosition(manifest, Math.max(0, description.resumeGlobalSec)) ?? undefined : undefined);
    return { sourceKey: { ...key }, title: description.title, artist: description.artist, artworkUrl: description.artworkUrl, documentId: description.documentId, editionId: description.editionId, mediaRevision: description.mediaRevision, complete: description.complete, parts: manifest, resume, release };
  } catch (error) { release(); throw error; }
}

/** Lazy imports keep expanded viewers and provider stacks out of shell initialization. */
export async function describeAudioSource(key: AudioSourceKey): Promise<AudioSourceDescription> {
  if (key.kind === "podcast") return describePodcast(key.sourceId);
  if (key.kind === "recording") return describeRecording(key.sourceId);
  if (key.kind === "audio_edition") return describeEdition(key.sourceId);
  const [{ getDocument }, { getDocumentPosition }] = await Promise.all([
    import("../../api/documents"),
    import("../../api/position"),
  ]);
  const document = await getDocument(key.sourceId);
  if (!document || !isDirectAudioFile(document)) throw new AudioPlaybackException("source_missing", "Audiobook unavailable");
  const revision = document.contentHash || document.filePath;
  const position = await getDocumentPosition(document.id);
  const description: AudioSourceDescription = { title: document.title, artworkUrl: document.coverImageUrl, documentId: document.id, mediaRevision: revision, complete: true, parts: [{ id: document.id, path: document.filePath, durationSec: null, revision }], resumeGlobalSec: position?.type === "time" ? position.seconds : 0 };
  // The persisted imported edition is authoritative after restart, including
  // devices that never wrote the old browser-only multipart metadata.
  const { getAudioEditionByDocument, getAudioEditionSections } = await import("../../api/audioEditions");
  const imported = await getAudioEditionByDocument(document.id);
  if (imported) {
    description.editionId = imported.id;
  }
  if (imported?.provider === "imported") {
    const sections = (await getAudioEditionSections(imported.id)).sort((a, b) => a.sectionIndex - b.sectionIndex);
    if (sections.length) {
      if (sections.some(section => section.generationStatus !== "ready" || !section.audioFilePath)) {
        throw new AudioPlaybackException("source_missing", "Imported audiobook parts are unavailable");
      }
      description.mediaRevision = imported.sourceRevisionHash;
      description.parts = sections.map(section => ({ id: section.id, path: section.audioFilePath!, revision: section.cacheKey, durationSec: getFiniteMediaDuration(section.durationSec), title: section.title }));
      return description;
    }
  }
  // Existing imported multipart manifests are stored alongside the legacy metadata.
  const raw = localStorage.getItem(`audiobook-${document.id}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { multiPart?: { partFiles?: unknown; partDurations?: unknown } };
      const files = parsed.multiPart?.partFiles;
      const durations = parsed.multiPart?.partDurations;
      if (Array.isArray(files) && files.length && files.every(path => typeof path === "string" && path.length > 0)) {
        description.parts = files.map((path, index) => ({ id: `${document.id}:${index}`, path, revision, durationSec: Array.isArray(durations) ? getFiniteMediaDuration(durations[index]) : null }));
      }
    } catch (error) { console.warn("[audio] Invalid legacy multipart manifest; using the original document", error); }
  }
  return description;
}

async function describePodcast(id: string): Promise<AudioSourceDescription> {
  const api = await import("../../api/podcast");
  const episode = (await api.getPodcastEpisodes(null)).find(episode => episode.id === id);
  if (!episode) throw new AudioPlaybackException("source_missing", "Podcast episode unavailable");
  let path = episode.audioUrl;
  try { path = await api.getDownloadedEpisodePath(id) || path; } catch (error) { console.warn("[audio] Local podcast lookup failed; using the episode URL", error); }
  let documentId: string | undefined;
  let editionId: string | undefined;
  try {
    const documentsApi = await import("../../api/documents");
    if (typeof documentsApi.getDocuments === "function") {
      const promoted = (await documentsApi.getDocuments()).find(
        doc => doc.fileType === "audio" && doc.metadata?.source === `podcast:${id}`,
      );
      documentId = promoted?.id;
    }
    if (documentId) {
      const { getAudioEditionByDocument } = await import("../../api/audioEditions");
      const edition = await getAudioEditionByDocument(documentId);
      editionId = edition?.id;
    }
  } catch {
    // Standalone podcast episodes remain playable even when document lookup is unavailable.
  }
  return {
    title: episode.title,
    artworkUrl: episode.imageUrl ?? undefined,
    documentId,
    editionId,
    mediaRevision: episode.guid || id,
    complete: true,
    parts: [{ id, path, fallbackPath: episode.audioUrl, durationSec: getFiniteMediaDuration(episode.duration ?? NaN), revision: episode.guid || id }],
    resumeGlobalSec: Math.max(0, episode.playbackPosition),
  };
}

async function describeEdition(id: string): Promise<AudioSourceDescription> {
  const [
    { getAudioEdition, getAudioEditionSections },
    { getDocument },
    { getAudioEditionPosition },
    { sectionAudioBlobCache, getSectionAudioUrl },
  ] = await Promise.all([
    import("../../api/audioEditions"),
    import("../../api/documents"),
    import("../../utils/audioEditionPosition"),
    import("../../stores/audioEditionGenerationStore"),
  ]);
  const edition = await getAudioEdition(id);
  if (!edition) throw new AudioPlaybackException("source_missing", "Audio Edition unavailable");
  if (edition.provider === "transcript") throw new AudioPlaybackException("source_missing", "Transcript-only edition has no synthesized audio");
  const sections = (await getAudioEditionSections(id)).sort((a, b) => a.sectionIndex - b.sectionIndex);
  // Never silently jump over an unprepared middle section.
  const ready: { section: (typeof sections)[number]; path: string }[] = [];
  for (const section of sections) {
    const cachedUrl = sectionAudioBlobCache.get(section.id);
    const sectionPath = cachedUrl || section.audioFilePath;
    if (section.generationStatus !== "ready" || !sectionPath) break;
    ready.push({ section, path: sectionPath });
  }
  const document = await getDocument(edition.sourceDocumentId);
  const saved = await getAudioEditionPosition(id, edition.sourceDocumentId);
  const startIndex = saved && saved.partIndex >= 0 && saved.partIndex < ready.length ? saved.partIndex : 0;
  for (let i = startIndex; i < ready.length && i <= startIndex + WORKING_SET_AHEAD; i++) {
    const touched = getSectionAudioUrl(ready[i].section.id);
    if (touched) ready[i].path = touched;
  }
  return {
    title: document?.title || "Audio Edition",
    artworkUrl: document?.coverImageUrl,
    documentId: edition.sourceDocumentId,
    editionId: id,
    mediaRevision: edition.sourceRevisionHash,
    complete: ready.length === sections.length && edition.status === "ready",
    parts: ready.map(({ section, path }) => ({
      id: section.id,
      path,
      durationSec: getFiniteMediaDuration(section.durationSec),
      revision: section.cacheKey,
      title: section.title,
    })),
    resume: saved ? { partIndex: saved.partIndex, timeInPart: saved.timeInPart } : undefined,
  };
}

export async function touchEditionWorkingSet(item: ResolvedAudioItem, activeIndex: number): Promise<ResolvedAudioItem> {
  if (item.sourceKey.kind !== "audio_edition") return item;
  const { getSectionAudioUrl } = await import("../../stores/audioEditionGenerationStore");
  let changed = false;
  const parts = item.parts.map((part, idx) => {
    if (idx < activeIndex || idx > activeIndex + WORKING_SET_AHEAD) return part;
    const liveUrl = getSectionAudioUrl(part.partId);
    if (liveUrl && liveUrl !== part.browserUrl) {
      changed = true;
      return { ...part, browserUrl: liveUrl };
    }
    return part;
  });
  return changed ? { ...item, parts } : item;
}

async function describeRecording(id: string): Promise<AudioSourceDescription> {
  const api = await import("../../api/recordingSessions");
  const session = await api.getRecordingSession(id);
  if (!session.mediaAssetId) throw new AudioPlaybackException("source_missing", "Transcript-only session");
  const asset = await api.getRecordingAsset(id, session.mediaAssetId);
  if (asset.state !== "ready") throw new AudioPlaybackException("source_missing", asset.state === "partial" ? "Recording is unfinished" : "Recording media unavailable");
  const { isTauri } = await import("../../lib/tauri");
  let path: string;
  if (isTauri()) {
    try {
      path = await api.getRecordingMediaPath(id);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw error;
      const classified = classifyAudioPlaybackError(error);
      throw new AudioPlaybackException(
        classified.code === "corrupt_media" ? "source_missing" : classified.code,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else if (asset.sourceUrl && isDirectAudioUrl(asset.sourceUrl)) {
    path = asset.sourceUrl;
  } else if (asset.relativePath) {
    path = asset.relativePath;
  } else {
    throw new AudioPlaybackException("source_missing", "Recording media unavailable");
  }
  const { getDocument } = await import("../../api/documents");
  const document = await getDocument(session.documentId).catch(() => null);
  const revision = asset.sha256 || asset.id;
  return { title: document?.title || "Recording", documentId: session.documentId, mediaRevision: revision, complete: true, parts: [{ id: asset.id, path, revision, durationSec: asset.durationMs === null ? null : getFiniteMediaDuration(asset.durationMs / 1000) }] };
}

export async function resolveBrowserOrDesktopAudio(key: AudioSourceKey, signal: AbortSignal): Promise<ResolvedAudioItem> {
  const { isTauri, isNativeAndroid, isNativeMobile, invokeCommand } = await import("../../lib/tauri");
  return resolveAudioSource(key, signal, {
    platform: isNativeAndroid() ? "android" : isNativeMobile() ? "ios" : isTauri() ? "desktop" : "browser",
    describe: describeAudioSource,
    prepare: async path => (await import("../../api/audiobooks")).prepareAudiobookPlayback(path),
    resolvePath: async path => {
      if (!isTauri()) {
        const [{ getBrowserFile }, database, urls] = await Promise.all([import("../../lib/browser-file-store"), import("../../lib/database"), import("../../diagnostics/ownedObjectUrl")]);
        const blob = getBrowserFile(path) ?? (await database.getFile(path))?.blob;
        if (!blob) throw new AudioPlaybackException("source_missing", "Local browser audio requires an available file handle");
        const url = urls.createOwnedObjectUrl(blob, { owner: "global-audio", ownerId: key.sourceId });
        return { url, release: () => urls.revokeOwnedObjectUrl(url) };
      }
      return invokeCommand<string>("get_media_stream_url", { filePath: path });
    },
  });
}
