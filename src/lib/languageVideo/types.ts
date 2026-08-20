import type { SentenceAudioAlignment } from "../languageAudioAlignment";
import type { SourceAnchor } from "../../types/languageLexicon";

export type VideoSubtitleMode = "target" | "base" | "dual" | "hidden";
export type VideoLanguageLayout = "desktop" | "tablet" | "mobile" | "e-ink";

export interface VideoTranscriptToken {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  sourceAnchor?: SourceAnchor;
  lexicalEntryId?: string;
  confidence?: number;
}

export interface VideoTranscriptSentence {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  sourceAnchor?: SourceAnchor;
  tokens: readonly VideoTranscriptToken[];
  alignment?: SentenceAudioAlignment;
}

export interface VideoLanguageSession {
  sessionId: string;
  videoId: string;
  profileId?: string;
  sourceFingerprint: string;
  sentences: readonly VideoTranscriptSentence[];
  currentSentenceId?: string;
  subtitleMode: VideoSubtitleMode;
  layout: VideoLanguageLayout;
  normalMode: boolean;
  autoPause: boolean;
  loopCurrent: boolean;
  startedAt: number;
}

export interface VideoLanguageMiningReference {
  videoId: string;
  sourceFingerprint: string;
  sentenceId: string;
  startMs: number;
  endMs: number;
  frameTimestampMs?: number;
  frameAvailable: boolean;
}
