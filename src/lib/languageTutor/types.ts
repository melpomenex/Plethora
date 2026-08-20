import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

export type TutorMode = "explain" | "conversation" | "correction" | "practice";
export type TutorAttribution = "grounded" | "generated" | "general";

export interface LearnerContextItem {
  entryId: string;
  surface: string;
  lemma?: string;
  state: LanguageKnowledgeState;
  evidenceCount: number;
  sourceDocumentId?: string;
  redacted: boolean;
}

export interface LearnerContextPacket {
  schemaVersion: 1;
  profileId: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  items: readonly LearnerContextItem[];
  currentSource?: { documentId?: string; text: string; redacted: boolean };
  generatedAt: number;
  freshness: "fresh" | "stale" | "partial";
}

export interface LearnerContextBudget {
  maxItems: number;
  maxTextCodeUnits: number;
  includeSourceText: boolean;
}

export interface TutorRequest {
  profileId: string;
  mode: TutorMode;
  message: string;
  context: LearnerContextPacket;
  signal?: AbortSignal;
}

export interface TutorResponse {
  text: string;
  attribution: TutorAttribution;
  targetEntryIds: readonly string[];
  providerId: string;
  providerVersion: string;
  createdAt: number;
}

export interface LanguageTutorProvider {
  id: string;
  version: string;
  supports(mode: TutorMode): boolean;
  respond(request: TutorRequest): Promise<TutorResponse>;
}

export interface TutorSessionMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  attribution?: TutorAttribution;
  createdAt: number;
}
