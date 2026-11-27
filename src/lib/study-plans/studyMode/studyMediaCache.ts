export interface StudyCachedMediaSegment {
  index: number;
  textHash: string;
  durationSec: number;
  audioUrl?: string | null;
  source: "tts_cache" | "tts_provider" | "speech_synthesis" | "timed_transcript";
}

export interface StudyCachedMediaManifest {
  artifactId: string;
  kind: "audio_script" | "slides";
  scopeKey: string;
  sourceRevision: string;
  lastPositionIndex: number;
  segments: StudyCachedMediaSegment[];
  cachedAt: string;
}

const MEDIA_CACHE_PREFIX = "plethora.studyMode.media.";

export function estimateSpeechDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round((words / 150) * 60));
}

export function hashMediaText(text: string): string {
  const norm = text.replace(/\s+/g, " ").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < norm.length; i += 1) {
    hash ^= norm.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function loadCachedStudyMedia(
  artifactId: string,
  expectedRevision?: string
): StudyCachedMediaManifest | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(`${MEDIA_CACHE_PREFIX}${artifactId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudyCachedMediaManifest;
    if (!parsed || parsed.artifactId !== artifactId) return null;
    if (expectedRevision && parsed.sourceRevision !== expectedRevision) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedStudyMedia(manifest: StudyCachedMediaManifest): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    // Strip ephemeral blob: URLs before persisting to localStorage; durable audio
    // bytes live in IndexedDB ttsCache and are resolved fresh on playback.
    const sanitizedSegments = manifest.segments.map((seg) => ({
      ...seg,
      audioUrl: seg.audioUrl && seg.audioUrl.startsWith("blob:") ? null : seg.audioUrl ?? null,
    }));
    window.localStorage.setItem(
      `${MEDIA_CACHE_PREFIX}${manifest.artifactId}`,
      JSON.stringify({
        ...manifest,
        segments: sanitizedSegments,
        cachedAt: manifest.cachedAt || new Date().toISOString(),
      })
    );
    return true;
  } catch {
    return false;
  }
}

export function clearCachedStudyMedia(artifactId: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(`${MEDIA_CACHE_PREFIX}${artifactId}`);
  } catch {
    // Ignore storage errors on clear
  }
}
