import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeCommand } from "../lib/tauri";
import type {
  MediaCacheUsage,
  MediaCompatibilityJobEvent,
  MediaInspection,
  MediaPlaybackPlan,
  MediaRuntimeCapabilities,
  MediaTransportProbe,
  StartMediaCompatibilityJobInput,
  MediaPlaybackPlanInput,
} from "../lib/media/types";

/** Inspect a local media document with FFprobe. */
export function inspectLocalMedia(
  documentId: string | null,
  filePath: string,
): Promise<MediaInspection> {
  return invokeCommand<MediaInspection>("inspect_local_media", {
    documentId,
    filePath,
  });
}

/** Return the runtime's playback capability report. */
export function getMediaRuntimeCapabilities(
  refresh = false,
): Promise<MediaRuntimeCapabilities> {
  return invokeCommand<MediaRuntimeCapabilities>("get_media_runtime_capabilities", {
    refresh,
  });
}

/** Produce the deterministic playback plan for a document. */
export function planMediaPlayback(
  request: MediaPlaybackPlanInput,
): Promise<MediaPlaybackPlan> {
  return invokeCommand<MediaPlaybackPlan>("plan_media_playback", { request });
}

/** Start or join a compatibility preparation job. */
export function startMediaCompatibilityJob(
  request: StartMediaCompatibilityJobInput,
): Promise<MediaCompatibilityJobEvent> {
  return invokeCommand<MediaCompatibilityJobEvent>("start_media_compatibility_job", {
    request,
  });
}

export function cancelMediaCompatibilityJob(
  jobId: string,
): Promise<MediaCompatibilityJobEvent> {
  return invokeCommand<MediaCompatibilityJobEvent>("cancel_media_compatibility_job", {
    jobId,
  });
}

export function listMediaCompatibilityJobs(
  documentId: string,
): Promise<MediaCompatibilityJobEvent[]> {
  return invokeCommand<MediaCompatibilityJobEvent[]>("list_media_compatibility_jobs", {
    documentId,
  });
}

export function getMediaCompatibilityArtifactUrl(
  documentId: string,
  cacheKey: string,
): Promise<string> {
  return invokeCommand<string>("get_media_compatibility_artifact_url", {
    documentId,
    cacheKey,
  });
}

export function getMediaCompatibilityCacheUsage(): Promise<MediaCacheUsage> {
  return invokeCommand<MediaCacheUsage>("get_media_compatibility_cache_usage");
}

export function clearMediaCompatibilityCache(
  documentId?: string,
): Promise<MediaCacheUsage> {
  return invokeCommand<MediaCacheUsage>("clear_media_compatibility_cache", {
    documentId: documentId ?? null,
  });
}

export function pruneMediaCompatibilityCache(
  limitGb: number,
): Promise<MediaCacheUsage> {
  return invokeCommand<MediaCacheUsage>("prune_media_compatibility_cache", {
    limitGb,
  });
}

export function subscribeToMediaCompatibilityJobs(
  handler: (event: MediaCompatibilityJobEvent) => void,
): Promise<UnlistenFn> {
  return listen<MediaCompatibilityJobEvent>("media-compat:job", (event) => {
    if (event.payload && typeof event.payload.jobId === "string") {
      handler(event.payload);
    }
  });
}

/** Probe the app's loopback media server without downloading the file. */
export function probeMediaTransport(url: string): Promise<MediaTransportProbe> {
  return invokeCommand<MediaTransportProbe>("probe_media_transport", { url });
}
