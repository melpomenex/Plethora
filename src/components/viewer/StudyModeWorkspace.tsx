import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createStudyFormativeQuestion,
  deleteStudyModeArtifactsForScope,
  dismissStudyModeArtifact,
  listStudyLearnerPreferences,
  listStudyModeArtifacts,
  recordStudyEfficacyEvent,
  saveStudyModeArtifact,
  submitStudyFormativeAnswer,
  upsertStudyModeSession,
} from "../../api/study-mode";
import { runTask } from "../../lib/ai/tasks/runTask";
import {
  studyModeAudioScriptTask,
  studyModeComponentTask,
  studyModeFormativeQuestionTask,
  studyModeMindMapTask,
  studyModeSlidesTask,
  studyModeTimelineTask,
} from "../../lib/ai/tasks/definitions/studyModeTasks";
import { buildBoundedLearnerContext } from "../../lib/study-plans/studyMode/learnerContext";
import { verifyStudyModeArtifactDeterministic } from "../../lib/study-plans/studyMode/pedagogicalVerifier";
import { useSettingsStore } from "../../stores/settingsStore";
import type {
  StudyFormativeQuestionClientView,
  StudyFormativeSubmissionResult,
  StudyLearnerPreference,
  StudyModeArtifact,
  StudyModeKnowledgeAuthority,
  StudyModeViewTab,
} from "../../types/studyMode";
import { StudyModePreferencesDrawer } from "./StudyModePreferencesDrawer";

export interface StudyModeWorkspaceProps {
  documentId: string;
  documentTitle: string;
  sourceRevision: string;
  passageText: string;
  subjectKey?: string;
  knowledgeAuthority?: StudyModeKnowledgeAuthority;
  studyPlanContext?: {
    planId: string;
    versionId: string;
    topicId: string;
    segmentId?: string;
  };
  onJumpToSource?: (quote?: string) => void;
  onExitStudyMode: () => void;
  onOpenTutor?: () => void;
  onPromoteFlashcard?: (prompt: string, explanation: string) => void;
}

const VIEW_TABS: Array<{ id: StudyModeViewTab; label: string }> = [
  { id: "learn", label: "Learn" },
  { id: "source", label: "Source" },
  { id: "practice", label: "Practice" },
  { id: "mind_map", label: "Mind Map" },
  { id: "audio", label: "Audio" },
  { id: "slides", label: "Slides" },
];

export const StudyModeWorkspace: React.FC<StudyModeWorkspaceProps> = ({
  documentId,
  documentTitle,
  sourceRevision,
  passageText,
  subjectKey = "__global__",
  knowledgeAuthority = "source-only",
  studyPlanContext,
  onJumpToSource,
  onExitStudyMode,
  onOpenTutor,
  onPromoteFlashcard,
}) => {
  const studySettings = useSettingsStore((s) => s.settings.studyMode);
  const [activeTab, setActiveTab] = useState<StudyModeViewTab>("learn");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<StudyModeArtifact[]>([]);
  const [preferences, setPreferences] = useState<StudyLearnerPreference[]>([]);
  const [showCustomize, setShowCustomize] = useState(false);
  const [loadingTask, setLoadingTask] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Practice state
  const [activeQuestion, setActiveQuestion] = useState<StudyFormativeQuestionClientView | null>(
    null
  );
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [writtenAnswer, setWrittenAnswer] = useState("");
  const [submissionResult, setSubmissionResult] = useState<StudyFormativeSubmissionResult | null>(
    null
  );

  // Slides state
  const [slideIndex, setSlideIndex] = useState(0);

  const scopeKey = useMemo(
    () =>
      studyPlanContext
        ? `plan:${studyPlanContext.planId}:${studyPlanContext.topicId}`
        : `doc:${documentId}`,
    [documentId, studyPlanContext]
  );

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        const session = await upsertStudyModeSession({
          scopeKind: studyPlanContext ? "study_plan_topic" : "standalone_document",
          documentId,
          studyPlanId: studyPlanContext?.planId ?? null,
          planVersionId: studyPlanContext?.versionId ?? null,
          topicId: studyPlanContext?.topicId ?? null,
          segmentId: studyPlanContext?.segmentId ?? null,
          sourceRevision,
          knowledgeAuthority,
          activeView: "learn",
        });
        if (!active) return;
        setSessionId(session.id);

        const [loadedArtifacts, loadedPrefs] = await Promise.all([
          listStudyModeArtifacts(scopeKey, false),
          listStudyLearnerPreferences(),
        ]);
        if (!active) return;
        setArtifacts(loadedArtifacts);
        setPreferences(loadedPrefs);
      } catch {
        // Non-Tauri or offline fallback remains usable
      }
    };
    void init();
    return () => {
      active = false;
    };
  }, [documentId, knowledgeAuthority, scopeKey, sourceRevision, studyPlanContext]);

  const learnerContext = useMemo(
    () =>
      studySettings?.enablePersonalization
        ? buildBoundedLearnerContext({ subjectKey, preferences })
        : undefined,
    [preferences, studySettings?.enablePersonalization, subjectKey]
  );

  const handleGenerateComponent = useCallback(
    async (
      componentType:
        | "explanation"
        | "worked_example"
        | "misconceptions"
        | "memory_aid"
        | "summary"
    ) => {
      setLoadingTask(componentType);
      setErrorMsg(null);
      const startedAt = Date.now();
      try {
        const result = await runTask(
          studyModeComponentTask,
          {
            sourceId: documentId,
            sourceTitle: documentTitle,
            passageText,
            knowledgeAuthority,
            learnerContext,
            componentType,
          },
          { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
        );
        const payload = result.output as unknown as Record<string, unknown>;
        const verification = verifyStudyModeArtifactDeterministic({
          artifactType: componentType,
          knowledgeAuthority,
          authorizedSourceIds: [documentId],
          expectedRevision: sourceRevision,
          artifactRevision: sourceRevision,
          sourceTexts: [passageText],
          payload,
        });

        if (!verification.valid) {
          setErrorMsg(
            `Verification failed (${verification.issues.join(", ")}). Try again or inspect the original source.`
          );
          return;
        }

        const saved = await saveStudyModeArtifact({
          sessionId,
          artifactType: componentType,
          scopeKey,
          sourceIds: [documentId],
          sourceRevision,
          anchors: [],
          segmentIds: studyPlanContext?.segmentId ? [studyPlanContext.segmentId] : [],
          conceptIds: [],
          objectiveIds: [],
          planId: studyPlanContext?.planId ?? null,
          planVersionId: studyPlanContext?.versionId ?? null,
          taskId: studyModeComponentTask.id,
          providerId: result.providerId ?? null,
          modelId: result.baseModelName ?? null,
          knowledgeAuthority,
          validationStatus: "verified",
          qualityEval: verification.report,
          payload,
        });
        setArtifacts((prev) => [saved, ...prev]);

        if (studySettings?.enableEfficacyMeasurement) {
          void recordStudyEfficacyEvent({
            sessionId,
            metricKind: "artifact_generated",
            latencyMs: Date.now() - startedAt,
            metadata: { artifactType: componentType },
          });
        }
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "No eligible AI provider is available. You can still read the original source."
        );
      } finally {
        setLoadingTask(null);
      }
    },
    [
      documentId,
      documentTitle,
      knowledgeAuthority,
      learnerContext,
      passageText,
      scopeKey,
      sessionId,
      sourceRevision,
      studyPlanContext,
      studySettings?.enableEfficacyMeasurement,
      studySettings?.localOnlyPreferred,
    ]
  );

  const handleGenerateStructuredView = useCallback(
    async (kind: "mind_map" | "timeline" | "audio_script" | "slides") => {
      setLoadingTask(kind);
      setErrorMsg(null);
      try {
        let payload: Record<string, unknown>;
        let taskId: string;
        let providerId: string | undefined;
        let modelId: string | undefined;

        if (kind === "mind_map") {
          const res = await runTask(
            studyModeMindMapTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText,
              knowledgeAuthority,
              learnerContext,
            },
            { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
          );
          payload = res.output;
          taskId = studyModeMindMapTask.id;
          providerId = res.providerId;
          modelId = res.baseModelName;
        } else if (kind === "timeline") {
          const res = await runTask(
            studyModeTimelineTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText,
              knowledgeAuthority,
              learnerContext,
            },
            { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
          );
          payload = res.output;
          taskId = studyModeTimelineTask.id;
          providerId = res.providerId;
          modelId = res.baseModelName;
        } else if (kind === "audio_script") {
          const res = await runTask(
            studyModeAudioScriptTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText,
              knowledgeAuthority,
              learnerContext,
              mode: "teacher_student",
            },
            { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
          );
          payload = res.output;
          taskId = studyModeAudioScriptTask.id;
          providerId = res.providerId;
          modelId = res.baseModelName;
        } else {
          const res = await runTask(
            studyModeSlidesTask,
            {
              sourceId: documentId,
              sourceTitle: documentTitle,
              passageText,
              knowledgeAuthority,
              learnerContext,
            },
            { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
          );
          payload = res.output;
          taskId = studyModeSlidesTask.id;
          providerId = res.providerId;
          modelId = res.baseModelName;
          setSlideIndex(0);
        }

        const verification = verifyStudyModeArtifactDeterministic({
          artifactType: kind,
          knowledgeAuthority,
          authorizedSourceIds: [documentId],
          expectedRevision: sourceRevision,
          artifactRevision: sourceRevision,
          sourceTexts: [passageText],
          payload,
        });

        if (!verification.valid) {
          setErrorMsg(`Verification failed (${verification.issues.join(", ")}).`);
          return;
        }

        const saved = await saveStudyModeArtifact({
          sessionId,
          artifactType: kind,
          scopeKey,
          sourceIds: [documentId],
          sourceRevision,
          anchors: [],
          segmentIds: studyPlanContext?.segmentId ? [studyPlanContext.segmentId] : [],
          conceptIds: [],
          objectiveIds: [],
          planId: studyPlanContext?.planId ?? null,
          planVersionId: studyPlanContext?.versionId ?? null,
          taskId,
          providerId: providerId ?? null,
          modelId: modelId ?? null,
          knowledgeAuthority,
          validationStatus: "verified",
          qualityEval: verification.report,
          payload,
        });
        setArtifacts((prev) => [saved, ...prev]);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Unable to generate view. Check AI provider availability."
        );
      } finally {
        setLoadingTask(null);
      }
    },
    [
      documentId,
      documentTitle,
      knowledgeAuthority,
      learnerContext,
      passageText,
      scopeKey,
      sessionId,
      sourceRevision,
      studyPlanContext,
      studySettings?.localOnlyPreferred,
    ]
  );

  const handleGeneratePracticeQuestion = useCallback(
    async (questionKind: "multiple_choice" | "short_answer") => {
      setLoadingTask("practice");
      setErrorMsg(null);
      setSubmissionResult(null);
      setSelectedOption(null);
      setWrittenAnswer("");
      try {
        const res = await runTask(
          studyModeFormativeQuestionTask,
          {
            sourceId: documentId,
            sourceTitle: documentTitle,
            passageText,
            knowledgeAuthority,
            learnerContext,
            questionKind,
          },
          { kind: studySettings?.localOnlyPreferred ? "ondevice" : undefined }
        );
        const data = res.output;
        const clientView = await createStudyFormativeQuestion({
          scopeKey,
          sessionId,
          segmentId: studyPlanContext?.segmentId ?? null,
          conceptIds: [studyPlanContext?.topicId ?? documentId],
          objectiveIds: [],
          questionKind,
          prompt: String(data.prompt ?? ""),
          options: Array.isArray(data.options) ? data.options.map(String) : null,
          answerKey: {
            correctIndex: typeof data.correctIndex === "number" ? data.correctIndex : 0,
            explanation: String(data.explanation ?? ""),
          },
          rubric: Array.isArray(data.requiredKeyFacts)
            ? { requiredKeyFacts: data.requiredKeyFacts }
            : null,
          difficulty: 2,
          questionFingerprint: `${scopeKey}:${Date.now()}`,
          sourceRefs: Array.isArray(data.citations) ? data.citations : [],
          knowledgeAuthority,
          provenance: { taskId: studyModeFormativeQuestionTask.id },
        });
        setActiveQuestion(clientView);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "Could not generate formative question."
        );
      } finally {
        setLoadingTask(null);
      }
    },
    [
      documentId,
      documentTitle,
      knowledgeAuthority,
      learnerContext,
      passageText,
      scopeKey,
      sessionId,
      studyPlanContext,
      studySettings?.localOnlyPreferred,
    ]
  );

  const handleSubmitPractice = async () => {
    if (!activeQuestion) return;
    setLoadingTask("submit_practice");
    try {
      const res = await submitStudyFormativeAnswer({
        submissionKey: `sub:${activeQuestion.id}:${selectedOption ?? writtenAnswer.slice(0, 24)}`,
        questionId: activeQuestion.id,
        sessionId,
        selectedIndex: activeQuestion.questionKind === "multiple_choice" ? selectedOption : null,
        learnerResponse: activeQuestion.questionKind === "short_answer" ? writtenAnswer : null,
        recordEvidence: knowledgeAuthority !== "model-only",
      });
      setSubmissionResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Grading failed.");
    } finally {
      setLoadingTask(null);
    }
  };

  const handleDismissArtifact = async (id: string) => {
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    await dismissStudyModeArtifact(id);
  };

  const handleClearScopeArtifacts = async () => {
    setArtifacts([]);
    await deleteStudyModeArtifactsForScope(scopeKey);
  };

  const learnArtifacts = artifacts.filter((a) =>
    ["explanation", "worked_example", "misconceptions", "memory_aid", "summary", "timeline"].includes(
      a.artifactType
    )
  );
  const mindMapArtifact = artifacts.find((a) => a.artifactType === "mind_map");
  const audioArtifact = artifacts.find((a) => a.artifactType === "audio_script");
  const slidesArtifact = artifacts.find((a) => a.artifactType === "slides");
  const slidesList = Array.isArray(slidesArtifact?.payload?.slides)
    ? (slidesArtifact.payload.slides as Array<Record<string, unknown>>)
    : [];

  return (
    <div
      className="flex flex-col h-full bg-background text-foreground border-l border-border"
      role="region"
      aria-label="Study Mode Workspace"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-card">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{documentTitle}</span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {knowledgeAuthority}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {studyPlanContext ? "Study Plan Context" : "Standalone Study Mode"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomize((v) => !v)}
            className="px-2.5 py-1.5 text-xs rounded border border-border hover:bg-muted"
          >
            Customize
          </button>
          <button
            type="button"
            onClick={onExitStudyMode}
            className="px-2.5 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            Exit Study Mode
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto" role="tablist">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {showCustomize && (
          <StudyModePreferencesDrawer
            subjectKey={subjectKey}
            onClose={() => setShowCustomize(false)}
            onUpdated={setPreferences}
          />
        )}

        {errorMsg && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {errorMsg}
          </div>
        )}

        {activeTab === "learn" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGenerateComponent("explanation")}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {loadingTask === "explanation" ? "Generating..." : "Alternative Explanation"}
              </button>
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGenerateComponent("worked_example")}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                Worked Example
              </button>
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGenerateComponent("misconceptions")}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                Common Misconceptions
              </button>
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGenerateComponent("summary")}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                Section Summary
              </button>
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGenerateStructuredView("timeline")}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                Sequence / Timeline
              </button>
              {artifacts.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearScopeArtifacts}
                  className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground ml-auto"
                >
                  Clear Generated
                </button>
              )}
            </div>

            {learnArtifacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Select a learning supplement above to generate source-grounded material on demand. Original document text is never modified.
              </p>
            ) : (
              <div className="space-y-3">
                {learnArtifacts.map((art) => (
                  <details
                    key={art.id}
                    open
                    className="rounded-lg border border-border bg-card p-3 space-y-2"
                  >
                    <summary className="flex items-center justify-between cursor-pointer text-sm font-medium">
                      <span>
                        {String(art.payload.title ?? art.artifactType)}
                        {art.isStale && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                            Source Updated (Stale)
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void handleDismissArtifact(art.id);
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Dismiss
                      </button>
                    </summary>
                    {art.artifactType === "timeline" && Array.isArray(art.payload.events) ? (
                      <ol className="space-y-2 pt-2 border-l-2 border-primary/40 pl-3 text-xs">
                        {(art.payload.events as Array<Record<string, unknown>>).map((ev, i) => (
                          <li key={i}>
                            <div className="font-semibold">
                              {String(ev.order ?? i + 1)}. {String(ev.label ?? "")} (
                              {String(ev.dateOrStage ?? "")})
                            </div>
                            <p className="text-muted-foreground">{String(ev.description ?? "")}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-xs space-y-2 pt-1">
                        <p className="whitespace-pre-wrap">{String(art.payload.body ?? "")}</p>
                        {onJumpToSource && (
                          <button
                            type="button"
                            onClick={() => onJumpToSource()}
                            className="text-primary hover:underline"
                          >
                            Compare with original source
                          </button>
                        )}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "source" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Authoritative Source Passage</h4>
              {onJumpToSource && (
                <button
                  type="button"
                  onClick={() => onJumpToSource()}
                  className="text-xs text-primary hover:underline"
                >
                  Focus in Reader
                </button>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-xs whitespace-pre-wrap leading-relaxed">
              {passageText || "No extractable passage text available for this scope."}
            </div>
          </div>
        )}

        {activeTab === "practice" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGeneratePracticeQuestion("multiple_choice")}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
              >
                {loadingTask === "practice" ? "Generating..." : "New Multiple Choice Check"}
              </button>
              <button
                type="button"
                disabled={Boolean(loadingTask)}
                onClick={() => handleGeneratePracticeQuestion("short_answer")}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                New Short Answer Check
              </button>
            </div>

            {activeQuestion && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-sm font-medium">{activeQuestion.prompt}</p>
                {activeQuestion.questionKind === "multiple_choice" && activeQuestion.options ? (
                  <div className="space-y-2">
                    {activeQuestion.options.map((opt, idx) => (
                      <label
                        key={idx}
                        className="flex items-center gap-2 text-xs p-2 rounded border border-border cursor-pointer hover:bg-muted/50"
                      >
                        <input
                          type="radio"
                          name={`q-${activeQuestion.id}`}
                          checked={selectedOption === idx}
                          onChange={() => setSelectedOption(idx)}
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={writtenAnswer}
                    onChange={(e) => setWrittenAnswer(e.target.value)}
                    placeholder="Explain in your own words..."
                    className="w-full rounded border border-border bg-background p-2 text-xs"
                  />
                )}
                <button
                  type="button"
                  disabled={
                    Boolean(loadingTask) ||
                    (activeQuestion.questionKind === "multiple_choice"
                      ? selectedOption === null
                      : !writtenAnswer.trim())
                  }
                  onClick={handleSubmitPractice}
                  className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
                >
                  Check Understanding
                </button>
              </div>
            )}

            {submissionResult && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3 text-xs">
                <div className="font-semibold">
                  Result: {submissionResult.outcome} (Score: {Math.round(submissionResult.score * 100)}%)
                </div>
                <p>{submissionResult.feedback}</p>
                {submissionResult.outcome !== "understood" && (
                  <div className="pt-2 border-t border-border space-y-2">
                    <div className="font-medium text-foreground">Recommended Remediation:</div>
                    <div className="flex flex-wrap gap-2">
                      {onJumpToSource && (
                        <button
                          type="button"
                          onClick={() => onJumpToSource()}
                          className="px-2.5 py-1 rounded border border-border hover:bg-muted"
                        >
                          Revisit Source Passage
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("learn");
                          void handleGenerateComponent("worked_example");
                        }}
                        className="px-2.5 py-1 rounded border border-border hover:bg-muted"
                      >
                        Show Worked Example
                      </button>
                      {onOpenTutor && (
                        <button
                          type="button"
                          onClick={onOpenTutor}
                          className="px-2.5 py-1 rounded border border-border hover:bg-muted"
                        >
                          Ask Socratic Tutor
                        </button>
                      )}
                      {onPromoteFlashcard && activeQuestion && (
                        <button
                          type="button"
                          onClick={() =>
                            onPromoteFlashcard(activeQuestion.prompt, submissionResult.feedback)
                          }
                          className="px-2.5 py-1 rounded border border-border hover:bg-muted"
                        >
                          Promote to Flashcard
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "mind_map" && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={Boolean(loadingTask)}
              onClick={() => handleGenerateStructuredView("mind_map")}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {loadingTask === "mind_map" ? "Generating..." : "Generate Source Mind Map"}
            </button>
            {mindMapArtifact && Array.isArray(mindMapArtifact.payload.nodes) && (
              <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs">
                <div className="font-semibold">
                  {String(mindMapArtifact.payload.title ?? "Concept Map")} (Not Assessed until practiced)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(mindMapArtifact.payload.nodes as Array<Record<string, unknown>>).map((n, i) => (
                    <div key={i} className="rounded border border-border p-2 space-y-1">
                      <div className="font-medium">{String(n.label ?? "")}</div>
                      <p className="text-muted-foreground">{String(n.definition ?? "")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "audio" && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={Boolean(loadingTask)}
              onClick={() => handleGenerateStructuredView("audio_script")}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {loadingTask === "audio_script" ? "Generating Script..." : "Generate Audio Lesson Script"}
            </button>
            {audioArtifact && Array.isArray(audioArtifact.payload.turns) && (
              <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs">
                <div className="font-semibold">
                  {String(audioArtifact.payload.title ?? "Audio Lesson")}
                </div>
                {(audioArtifact.payload.turns as Array<Record<string, unknown>>).map((turn, i) => (
                  <div key={i} className="p-2 rounded bg-muted/40">
                    <span className="font-semibold uppercase mr-2">
                      {String(turn.speaker ?? "teacher")}:
                    </span>
                    <span>{String(turn.text ?? "")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "slides" && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={Boolean(loadingTask)}
              onClick={() => handleGenerateStructuredView("slides")}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {loadingTask === "slides" ? "Generating Slides..." : "Generate Narrated Slides"}
            </button>
            {slidesList.length > 0 && (
              <div
                className="rounded-lg border border-border bg-card p-4 space-y-3"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    setSlideIndex((i) => Math.min(slidesList.length - 1, i + 1));
                  } else if (e.key === "ArrowLeft") {
                    setSlideIndex((i) => Math.max(0, i - 1));
                  }
                }}
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Slide {slideIndex + 1} of {slidesList.length}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={slideIndex === 0}
                      onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                      className="px-2 py-1 rounded border border-border disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={slideIndex >= slidesList.length - 1}
                      onClick={() => setSlideIndex((i) => Math.min(slidesList.length - 1, i + 1))}
                      className="px-2 py-1 rounded border border-border disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
                <h4 className="text-base font-semibold">
                  {String(slidesList[slideIndex]?.title ?? "")}
                </h4>
                <ul className="list-disc pl-5 text-xs space-y-1">
                  {Array.isArray(slidesList[slideIndex]?.bullets) &&
                    (slidesList[slideIndex].bullets as unknown[]).map((b, idx) => (
                      <li key={idx}>{String(b)}</li>
                    ))}
                </ul>
                <div className="pt-2 border-t border-border text-xs text-muted-foreground">
                  <strong>Narration:</strong> {String(slidesList[slideIndex]?.narration ?? "")}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
