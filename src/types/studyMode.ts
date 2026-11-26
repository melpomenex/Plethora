export type StudyModeScopeKind =
  | "standalone_document"
  | "standalone_selection"
  | "study_plan_topic"
  | "study_plan_segment";

export type StudyModeViewTab =
  | "learn"
  | "source"
  | "practice"
  | "mind_map"
  | "audio"
  | "slides";

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
