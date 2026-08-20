import type { SourceAnchor } from "../../types/languageLexicon";

export type ReadingAssistKind = "segmentation" | "transliteration" | "ruby" | "gloss" | "bidi" | "line-break";
export type ReadingAssistDirection = "ltr" | "rtl" | "ttb";
export type ReadingAssistStatus = "ready" | "pending" | "stale" | "unsupported" | "failed";

export interface AssistSpan {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  renderedText?: string;
  annotation?: string;
  sourceAnchor?: SourceAnchor;
  confidence?: number;
}

export interface ReadingAssistResult {
  sourceId: string;
  contentFingerprint: string;
  profileId?: string;
  kind: ReadingAssistKind;
  direction: ReadingAssistDirection;
  script?: string;
  status: ReadingAssistStatus;
  providerId: string;
  providerVersion: string;
  spans: readonly AssistSpan[];
  createdAt: number;
  error?: string;
}

export interface ReadingAssistCapabilities {
  providerId: string;
  providerVersion: string;
  kinds: readonly ReadingAssistKind[];
  languages: readonly string[];
  offline: boolean;
  maxCodeUnits: number;
  preservesSource: boolean;
}

export interface ReadingAssistRequest {
  sourceId: string;
  contentFingerprint: string;
  text: string;
  languageTag: string;
  profileId?: string;
  kind: ReadingAssistKind;
  direction?: ReadingAssistDirection;
}

export interface ReadingAssistProvider {
  capabilities: ReadingAssistCapabilities;
  assist(request: ReadingAssistRequest, signal?: AbortSignal): Promise<ReadingAssistResult>;
}
