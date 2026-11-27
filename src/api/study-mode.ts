import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  StudyFormativeQuestionClientView,
  StudyFormativeSubmissionResult,
  StudyLearnerPreference,
  StudyModeArtifact,
  StudyModeSession,
  StudyModeVerificationResult,
} from "../types/studyMode";

export async function findStudyModeSessionByScope(input: {
  scopeKind: string;
  scopeKey?: string | null;
  documentId?: string | null;
  studyPlanId?: string | null;
  topicId?: string | null;
  segmentId?: string | null;
}): Promise<StudyModeSession | null> {
  if (!isTauri()) {
    return null;
  }
  return invokeCommand<StudyModeSession | null>("find_study_mode_session_by_scope", {
    scopeKind: input.scopeKind,
    scopeKey: input.scopeKey ?? null,
    documentId: input.documentId ?? null,
    studyPlanId: input.studyPlanId ?? null,
    topicId: input.topicId ?? null,
    segmentId: input.segmentId ?? null,
  });
}

export async function upsertStudyModeSession(input: {
  id?: string | null;
  scopeKind: string;
  scopeKey?: string | null;
  documentId?: string | null;
  studyPlanId?: string | null;
  planVersionId?: string | null;
  topicId?: string | null;
  segmentId?: string | null;
  sourceRevision: string;
  knowledgeAuthority?: string | null;
  activeView?: string | null;
  lastLocatorJson?: string | null;
}): Promise<StudyModeSession> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    return {
      id: input.id ?? `session_${Date.now()}`,
      scopeKind: input.scopeKind as StudyModeSession["scopeKind"],
      scopeKey: input.scopeKey ?? null,
      documentId: input.documentId ?? null,
      studyPlanId: input.studyPlanId ?? null,
      planVersionId: input.planVersionId ?? null,
      topicId: input.topicId ?? null,
      segmentId: input.segmentId ?? null,
      sourceRevision: input.sourceRevision,
      knowledgeAuthority: (input.knowledgeAuthority ?? "source-only") as StudyModeSession["knowledgeAuthority"],
      activeView: (input.activeView ?? "learn") as StudyModeSession["activeView"],
      lastLocatorJson: input.lastLocatorJson ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }
  return invokeCommand<StudyModeSession>("upsert_study_mode_session", { input });
}

export async function saveStudyModeArtifact(input: {
  id?: string | null;
  sessionId?: string | null;
  artifactType: string;
  schemaVersion?: number;
  scopeKey: string;
  sourceIds: string[];
  sourceRevision: string;
  anchors: unknown[];
  segmentIds: string[];
  conceptIds: string[];
  objectiveIds: string[];
  planId?: string | null;
  planVersionId?: string | null;
  preferenceFingerprint?: string | null;
  taskId: string;
  taskVersion?: string | null;
  promptVersion?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  knowledgeAuthority: string;
  validationStatus: string;
  qualityEval?: unknown;
  payload: Record<string, unknown>;
  isLocked?: boolean;
}): Promise<StudyModeArtifact> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    return {
      id: input.id ?? `artifact_${Date.now()}`,
      sessionId: input.sessionId ?? null,
      artifactType: input.artifactType,
      schemaVersion: input.schemaVersion ?? 1,
      scopeKey: input.scopeKey,
      sourceIds: input.sourceIds,
      sourceRevision: input.sourceRevision,
      anchors: input.anchors,
      segmentIds: input.segmentIds,
      conceptIds: input.conceptIds,
      objectiveIds: input.objectiveIds,
      planId: input.planId ?? null,
      planVersionId: input.planVersionId ?? null,
      preferenceFingerprint: input.preferenceFingerprint ?? "",
      taskId: input.taskId,
      taskVersion: input.taskVersion ?? "1",
      promptVersion: input.promptVersion ?? "1",
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      knowledgeAuthority: input.knowledgeAuthority as StudyModeArtifact["knowledgeAuthority"],
      validationStatus: input.validationStatus,
      qualityEval: (input.qualityEval as StudyModeArtifact["qualityEval"]) ?? null,
      payload: input.payload,
      isStale: false,
      isLocked: input.isLocked ?? false,
      dismissed: false,
      createdAt: now,
      updatedAt: now,
    };
  }
  return invokeCommand<StudyModeArtifact>("save_study_mode_artifact", { input });
}

export async function listStudyModeArtifacts(
  scopeKey: string,
  includeDismissed = false
): Promise<StudyModeArtifact[]> {
  if (!isTauri()) return [];
  return invokeCommand<StudyModeArtifact[]>("list_study_mode_artifacts", {
    scopeKey,
    includeDismissed,
  });
}

export async function markStudyModeArtifactsStale(
  scopeKey: string,
  currentRevision: string,
): Promise<number> {
  if (!isTauri()) return 0;
  return invokeCommand<number>("mark_study_mode_artifacts_stale", {
    scopeKey,
    currentRevision,
  });
}

export async function dismissStudyModeArtifact(artifactId: string): Promise<void> {
  if (!isTauri()) return;
  return invokeCommand<void>("dismiss_study_mode_artifact", { artifactId });
}

export async function restoreStudyModeArtifact(
  artifactId: string
): Promise<StudyModeArtifact | null> {
  if (!isTauri()) return null;
  return invokeCommand<StudyModeArtifact>("restore_study_mode_artifact", { artifactId });
}

export async function deleteStudyModeArtifact(artifactId: string): Promise<void> {
  if (!isTauri()) return;
  return invokeCommand<void>("delete_study_mode_artifact", { artifactId });
}

export async function deleteStudyModeArtifactsForScope(scopeKey: string): Promise<number> {
  if (!isTauri()) return 0;
  return invokeCommand<number>("delete_study_mode_artifacts_for_scope", { scopeKey });
}

export async function listStudyLearnerPreferences(): Promise<StudyLearnerPreference[]> {
  if (!isTauri()) return [];
  return invokeCommand<StudyLearnerPreference[]>("list_study_learner_preferences");
}

export async function upsertStudyLearnerPreference(input: {
  subjectKey: string;
  knowledgeLevel?: string | null;
  interests?: string[];
  familiarDomains?: string[];
  explanationDetail?: string;
  vocabularyTolerance?: string;
  explanationLanguage?: string | null;
  teachingApproach?: string;
  examplePreference?: string;
  questionDifficulty?: string;
}): Promise<StudyLearnerPreference> {
  if (!isTauri()) {
    return {
      id: `pref_${input.subjectKey}`,
      subjectKey: input.subjectKey.toLowerCase() || "__global__",
      knowledgeLevel: input.knowledgeLevel ?? null,
      interests: input.interests ?? [],
      familiarDomains: input.familiarDomains ?? [],
      explanationDetail: input.explanationDetail ?? "balanced",
      vocabularyTolerance: input.vocabularyTolerance ?? "standard",
      explanationLanguage: input.explanationLanguage ?? null,
      teachingApproach: input.teachingApproach ?? "balanced",
      examplePreference: input.examplePreference ?? "everyday",
      questionDifficulty: input.questionDifficulty ?? "adaptive",
      updatedAt: new Date().toISOString(),
    };
  }
  return invokeCommand<StudyLearnerPreference>("upsert_study_learner_preference", { input });
}

export async function deleteStudyLearnerPreference(subjectKey: string): Promise<void> {
  if (!isTauri()) return;
  return invokeCommand<void>("delete_study_learner_preference", { subjectKey });
}

export async function createStudyFormativeQuestion(input: {
  scopeKey: string;
  sessionId?: string | null;
  segmentId?: string | null;
  conceptIds: string[];
  objectiveIds: string[];
  questionKind: string;
  prompt: string;
  options?: string[] | null;
  answerKey: Record<string, unknown>;
  rubric?: Record<string, unknown> | null;
  difficulty?: number;
  questionFingerprint: string;
  sourceRefs: unknown[];
  knowledgeAuthority: string;
  provenance: Record<string, unknown>;
}): Promise<StudyFormativeQuestionClientView> {
  if (!isTauri()) {
    return {
      id: `q_local_${Date.now()}`,
      revision: 1,
      scopeKey: input.scopeKey,
      sessionId: input.sessionId ?? null,
      segmentId: input.segmentId ?? null,
      conceptIds: input.conceptIds,
      objectiveIds: input.objectiveIds,
      questionKind: input.questionKind,
      prompt: input.prompt,
      options: input.options ?? null,
      difficulty: input.difficulty ?? 2,
      questionFingerprint: input.questionFingerprint,
      sourceRefs: input.sourceRefs,
      knowledgeAuthority: input.knowledgeAuthority as StudyFormativeQuestionClientView["knowledgeAuthority"],
      createdAt: new Date().toISOString(),
    };
  }
  return invokeCommand<StudyFormativeQuestionClientView>("create_study_formative_question", {
    input,
  });
}

export async function submitStudyFormativeAnswer(input: {
  submissionKey: string;
  questionId: string;
  sessionId?: string | null;
  selectedIndex?: number | null;
  learnerResponse?: string | null;
  aiRubricScore?: number | null;
  aiFeedback?: string | null;
  aiMisconception?: string | null;
  confidence?: number | null;
  usedHint?: boolean;
  recordEvidence?: boolean;
}): Promise<StudyFormativeSubmissionResult> {
  if (!isTauri()) {
    const score = typeof input.aiRubricScore === "number" ? input.aiRubricScore : 0;
    return {
      id: `sub_local_${Date.now()}`,
      submissionKey: input.submissionKey,
      questionId: input.questionId,
      questionRevision: 1,
      outcome: score >= 0.8 ? "understood" : score >= 0.4 ? "partial" : "needs_review",
      score,
      feedback: input.aiFeedback ?? "Answer evaluated locally.",
      misconceptionDetected: input.aiMisconception ?? null,
      graderOrigin: "deterministic",
      evidenceRecorded: false,
      deduplicated: false,
      createdAt: new Date().toISOString(),
    };
  }
  return invokeCommand<StudyFormativeSubmissionResult>("submit_study_formative_answer", {
    input,
  });
}

export async function verifyStudyModeArtifact(input: {
  artifactType: string;
  knowledgeAuthority: string;
  authorizedSourceIds: string[];
  expectedRevision: string;
  artifactRevision: string;
  sourceTexts: string[];
  payload: Record<string, unknown>;
}): Promise<StudyModeVerificationResult> {
  if (!isTauri()) {
    return {
      valid: true,
      issues: [],
      report: {
        hardGatePassed: true,
        hardGateFailures: [],
        criteria: [],
        evaluatorOrigin: "client-fallback",
      },
    };
  }
  return invokeCommand<StudyModeVerificationResult>("verify_study_mode_artifact", { input });
}

export async function recordStudyEfficacyEvent(input: {
  sessionId?: string | null;
  metricKind: string;
  conceptId?: string | null;
  score?: number | null;
  latencyMs?: number | null;
  costUsd?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  if (!isTauri()) return "";
  return invokeCommand<string>("record_study_efficacy_event", { input });
}
