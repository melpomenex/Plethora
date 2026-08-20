import type { SourceAnchor } from "../../types/languageLexicon";

export type SentenceModeFreshness = "ready" | "pending" | "stale" | "unsupported" | "offline";
export type SentenceModeSource = "epub" | "pdf-reflow" | "pdf-fixed" | "html" | "markdown" | "text" | "queue" | "transcript";

export interface SentenceIdentity {
  sentenceId: string;
  sourceId: string;
  contentFingerprint: string;
  analysisVersion?: string;
  sourceAnchor?: SourceAnchor;
}

export interface SentenceSegment {
  identity: SentenceIdentity;
  index: number;
  text: string;
  startOffset?: number;
  endOffset?: number;
  freshness: SentenceModeFreshness;
}

export interface SentenceModeReturnAnchor {
  documentId?: string;
  sourceId: string;
  sourceAnchor?: SourceAnchor;
  position?: number;
}

export interface SentenceModeSession {
  sessionId: string;
  profileId?: string;
  source: SentenceModeSource;
  sourceId: string;
  contentFingerprint: string;
  entrySentenceId: string;
  currentSentenceId: string;
  returnAnchor: SentenceModeReturnAnchor;
  indexOffset: number;
  indexLimit: number;
  progress: { current: number; total?: number };
  freshness: SentenceModeFreshness;
  startedAt: number;
}

export interface SentenceModeIndexAdapter {
  readonly source: SentenceModeSource;
  readonly sourceId: string;
  readonly contentFingerprint: string;
  getWindow(offset: number, limit: number, signal?: AbortSignal): Promise<readonly SentenceSegment[]>;
  resolve(sentenceId: string, signal?: AbortSignal): Promise<SentenceSegment | null>;
}

export interface CreateSentenceModeSessionInput {
  sessionId: string;
  source: SentenceModeSource;
  sourceId: string;
  contentFingerprint: string;
  entry: SentenceSegment;
  returnAnchor: SentenceModeReturnAnchor;
  profileId?: string;
  total?: number;
  startedAt?: number;
}
