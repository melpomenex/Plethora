import type { LearnerContextPacket } from "../languageTutor";

export type ContentGenerationAction = "generate" | "simplify" | "harder";
export type ContentGenerationStatus = "ready" | "pending" | "cancelled" | "failed" | "offline";

export interface LanguageContentGenerationRequest {
  requestId: string;
  profileId: string;
  action: ContentGenerationAction;
  topic: string;
  genre?: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  length: "short" | "medium" | "long";
  learnerContext: LearnerContextPacket;
  privacy: "local-only" | "allow-cloud";
  signal?: AbortSignal;
}

export interface GeneratedLanguageDocument {
  documentId: string;
  profileId: string;
  title: string;
  content: string;
  sourceDocumentId?: string;
  sourceFingerprint?: string;
  generatedFingerprint: string;
  targetLanguage: string;
  measuredCoverageStatus: "pending" | "ready" | "stale" | "unavailable";
  providerId: string;
  providerVersion: string;
  createdAt: number;
  provenance: { requestId: string; action: ContentGenerationAction; privacy: "local-only" | "allow-cloud" };
}

export interface LanguageContentGenerator {
  id: string;
  version: string;
  supports(action: ContentGenerationAction): boolean;
  generate(request: LanguageContentGenerationRequest): Promise<GeneratedLanguageDocument>;
}
