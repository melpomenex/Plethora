import { getPodcastTranscript, type PodcastTranscriptResponse } from "../../api/podcast";

export type PodcastTranscriptState = "ready" | "active" | "missing" | "error";

export function podcastTranscriptState(result: PodcastTranscriptResponse): PodcastTranscriptState {
  if (result.text.trim() || result.segments.some((segment) => segment.text.trim())) return "ready";
  if (["pending", "processing", "transcribing", "downloading"].includes(result.status)) return "active";
  return !result.status || result.status === "none" ? "missing" : "error";
}

type StartRequest = { start: () => Promise<void>; isCurrent: () => boolean; retry: boolean };
const starts = new Map<string, { promise: Promise<void>; requests: StartRequest[] }>();

export function startPodcastTranscriptionOnce(
  episodeId: string,
  start: () => Promise<void>,
  isCurrent: () => boolean,
  retry = false,
): Promise<void> {
  const request = { start, isCurrent, retry };
  const existing = starts.get(episodeId);
  if (existing) {
    existing.requests.push(request);
    return existing.promise;
  }
  const requests = [request];
  const pending = (async () => {
    const result = await getPodcastTranscript(episodeId);
    const state = podcastTranscriptState(result);
    const current = requests.find((candidate) => candidate.isCurrent());
    if (current && (state === "missing" || (current.retry && ["error", "unavailable"].includes(result.status)))) await current.start();
  })().finally(() => {
    if (starts.get(episodeId)?.promise === pending) starts.delete(episodeId);
  });
  starts.set(episodeId, { promise: pending, requests });
  return pending;
}
