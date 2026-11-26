import type { LearnerContextPacket } from "../languageTutor";

export const CONTENT_GENERATION_MODES = [
  "short-story",
  "article",
  "dialogue",
  "explanatory-passage",
  "graded-reader",
  "vocabulary-reinforcement",
  "grammar-focus",
  "comprehension-exercise",
  "listening-passage",
  "personalized-conversation",
] as const;

export const DOCUMENT_ADAPTATION_ACTIONS = [
  "simplify",
  "make-harder",
  "harder",
  "explain-passages",
  "rewrite-familiar",
  "shorter-version",
  "graded-adaptation",
] as const;

export type ContentGenerationMode = (typeof CONTENT_GENERATION_MODES)[number];
export type DocumentAdaptationAction = (typeof DOCUMENT_ADAPTATION_ACTIONS)[number];
export type ContentGenerationAction =
  | "generate"
  | ContentGenerationMode
  | DocumentAdaptationAction;

export const ALL_CONTENT_GENERATION_ACTIONS: readonly ContentGenerationAction[] = [
  "generate",
  ...CONTENT_GENERATION_MODES,
  ...DOCUMENT_ADAPTATION_ACTIONS,
];

export type ContentGenerationStatus = "ready" | "pending" | "cancelled" | "failed" | "offline";

export interface ContentGenerationRefinementFeedback {
  attempt: number;
  previousText: string;
  measuredCoveragePercent: number;
  targetCoveragePercent: number;
  unknownWords?: readonly string[];
}

export interface LanguageContentGenerationRequest {
  requestId: string;
  profileId: string;
  action: ContentGenerationAction;
  mode?: ContentGenerationMode;
  topic: string;
  genre?: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  length: "short" | "medium" | "long";
  learnerContext: LearnerContextPacket;
  privacy: "local-only" | "allow-cloud";
  allowCloud?: boolean;
  sourceDocumentId?: string;
  sourceText?: string;
  sourceFingerprint?: string;
  targetCoveragePercent?: number;
  targetVocabulary?: readonly string[];
  grammarFocus?: string;
  refinementFeedback?: ContentGenerationRefinementFeedback;
  maxOutputTokens?: number;
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
  measuredCoveragePercent?: number;
  claimedCoveragePercent?: number;
  providerId: string;
  providerVersion: string;
  modelId?: string;
  createdAt: number;
  provenance: {
    requestId: string;
    action: ContentGenerationAction;
    privacy: "local-only" | "allow-cloud";
    mode?: ContentGenerationMode;
    providerKind?: "ondevice" | "cloud";
    modelId?: string;
    sourceDocumentId?: string;
  };
}

export interface LanguageContentGenerator {
  id: string;
  version: string;
  supports(action: ContentGenerationAction): boolean;
  generate(request: LanguageContentGenerationRequest): Promise<GeneratedLanguageDocument>;
}
