import type { ExactSearchHitLocation } from "./searchHit";

export type DocumentPresentationMode = "read" | "study";

export type StudyWorkspaceLayout = "focused" | "with-source" | "with-assistant";

export type StudyModeScopeKind =
  | "standalone_document"
  | "standalone_selection"
  | "study_plan_topic"
  | "study_plan_segment";

export type StudyModeViewTab = "learn" | "practice" | "explore" | "progress";

export type LegacyStudyModeViewTab =
  | StudyModeViewTab
  | "source"
  | "mind_map"
  | "audio"
  | "slides";

export type StudyModeExploreSubView = "concept_map" | "timeline" | "audio" | "slides";

export type StudyModeSessionDuration = 5 | 15 | 30;

export interface StudySourceAnchor {
  sourceId: string;
  sourceRevision: string;
  quote?: string;
  charStart?: number;
  charEnd?: number;
  locator: ExactSearchHitLocation;
  label?: string;
}

export interface StudyModeSessionSnapshot {
  activeTab: StudyModeViewTab;
  exploreSubView: StudyModeExploreSubView;
  activeObjectiveId: string | null;
  activeQuestionId: string | null;
  draftAnswer?: string | null;
  activeScopeId?: string | null;
  sessionDurationMin: StudyModeSessionDuration;
  focusMode: boolean;
  lastLocator: ExactSearchHitLocation | null;
  leftPaneWidth: number;
  rightPaneWidth: number;
  leftPaneCollapsed: boolean;
  rightPaneCollapsed: boolean;
  updatedAt: string;
}

export function normalizeStudyModeTab(raw?: string | null): {
  tab: StudyModeViewTab;
  exploreSubView?: StudyModeExploreSubView;
} {
  switch (raw) {
    case "learn":
    case "source":
      return { tab: "learn" };
    case "practice":
      return { tab: "practice" };
    case "explore":
      return { tab: "explore" };
    case "mind_map":
      return { tab: "explore", exploreSubView: "concept_map" };
    case "audio":
      return { tab: "explore", exploreSubView: "audio" };
    case "slides":
      return { tab: "explore", exploreSubView: "slides" };
    case "progress":
      return { tab: "progress" };
    default:
      return { tab: "learn" };
  }
}

export type StudyModeKnowledgeAuthority =
  | "source-only"
  | "source-plus-model"
  | "model-only";

export type PedagogicalCriterionId =
  | "accuracy"
  | "source_fidelity"
  | "coverage"
  | "emphasis"
  | "engagement"
  | "cognitive_load"
  | "active_learning"
  | "metacognition"
  | "motivation_curiosity"
  | "adaptability"
  | "clarity_of_intentions";

export type PedagogicalRating = "pass" | "partial" | "fail" | "not_assessable";

export interface PedagogicalCriterionScore {
  criterion: PedagogicalCriterionId;
  rating: PedagogicalRating;
  rationale: string;
  evidence: string[];
}

export interface PedagogicalEvaluationReport {
  hardGatePassed: boolean;
  hardGateFailures: string[];
  criteria: PedagogicalCriterionScore[];
  evaluatorOrigin: string;
}

export interface StudyModeVerificationResult {
  valid: boolean;
  issues: string[];
  report: PedagogicalEvaluationReport;
}

export interface StudyModeSession {
  id: string;
  scopeKind: StudyModeScopeKind;
  scopeKey?: string | null;
  documentId: string | null;
  studyPlanId: string | null;
  planVersionId: string | null;
  topicId: string | null;
  segmentId: string | null;
  sourceRevision: string;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  activeView: StudyModeViewTab;
  lastLocatorJson: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyModeArtifact {
  id: string;
  sessionId: string | null;
  artifactType: string;
  schemaVersion: number;
  scopeKey: string;
  sourceIds: string[];
  sourceRevision: string;
  anchors: unknown[];
  segmentIds: string[];
  conceptIds: string[];
  objectiveIds: string[];
  planId: string | null;
  planVersionId: string | null;
  preferenceFingerprint: string;
  taskId: string;
  taskVersion: string;
  promptVersion: string;
  providerId: string | null;
  modelId: string | null;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  validationStatus: string;
  qualityEval: PedagogicalEvaluationReport | null;
  payload: Record<string, unknown>;
  isStale: boolean;
  isLocked: boolean;
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyLearnerPreference {
  id: string;
  subjectKey: string;
  knowledgeLevel: string | null;
  interests: string[];
  familiarDomains: string[];
  explanationDetail: "concise" | "balanced" | "detailed" | string;
  vocabularyTolerance: "plain" | "standard" | "technical" | string;
  explanationLanguage: string | null;
  teachingApproach: "balanced" | "example-first" | "first-principles" | "socratic" | string;
  examplePreference: string;
  questionDifficulty: "foundational" | "adaptive" | "challenging" | string;
  updatedAt: string;
}

export interface StudyFormativeQuestionClientView {
  id: string;
  revision: number;
  scopeKey: string;
  sessionId: string | null;
  segmentId: string | null;
  conceptIds: string[];
  objectiveIds: string[];
  questionKind: string;
  prompt: string;
  options: string[] | null;
  difficulty: number;
  questionFingerprint: string;
  sourceRefs: unknown[];
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  createdAt: string;
}

export interface StudyFormativeSubmissionResult {
  id: string;
  submissionKey: string;
  questionId: string;
  questionRevision: number;
  outcome: "understood" | "partial" | "needs_review" | string;
  score: number;
  feedback: string;
  misconceptionDetected: string | null;
  graderOrigin: string;
  evidenceRecorded: boolean;
  deduplicated: boolean;
  createdAt: string;
}

export interface StudyModeSettings {
  showEntryPoints: boolean;
  rememberModePerSource: boolean;
  enablePersonalization: boolean;
  checkSuggestionMode: "manual" | "section";
  questionFrequency: "low" | "section" | "frequent";
  localOnlyPreferred: boolean;
  enableCaching: boolean;
  enableEfficacyMeasurement: boolean;
}
