import type { VideoLanguageLayout, VideoLanguageSession, VideoSubtitleMode, VideoTranscriptSentence } from "./types";

export function createVideoLanguageSession(input: Omit<VideoLanguageSession, "currentSentenceId" | "startedAt"> & { currentSentenceId?: string; startedAt?: number }): VideoLanguageSession {
  return { ...input, currentSentenceId: input.currentSentenceId ?? input.sentences[0]?.id, startedAt: input.startedAt ?? Date.now() };
}

export function selectVideoSentence(session: VideoLanguageSession, sentenceId: string): VideoLanguageSession {
  if (!session.sentences.some((sentence) => sentence.id === sentenceId)) return session;
  return { ...session, currentSentenceId: sentenceId };
}

export function currentVideoSentence(session: VideoLanguageSession): VideoTranscriptSentence | null {
  return session.sentences.find((sentence) => sentence.id === session.currentSentenceId) ?? null;
}

export function setVideoLanguageMode(session: VideoLanguageSession, updates: Partial<Pick<VideoLanguageSession, "subtitleMode" | "layout" | "autoPause" | "loopCurrent">>): VideoLanguageSession {
  return { ...session, ...updates };
}

export function leaveVideoLanguageMode(session: VideoLanguageSession): VideoLanguageSession {
  return { ...session, normalMode: true };
}

export function supportsVideoLayout(layout: VideoLanguageLayout, reducedMotion: boolean): boolean {
  return layout === "e-ink" || reducedMotion || layout !== "mobile";
}

export function subtitleModeLabel(mode: VideoSubtitleMode): string {
  return mode === "dual" ? "Target + base" : mode[0]!.toUpperCase() + mode.slice(1);
}
