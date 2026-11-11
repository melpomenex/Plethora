/**
 * Assessment Builder & Generation Coordinator Aggregate Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.1–§5.5
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkle,
  FloppyDisk,
  CheckCircle,
  X,
  Pencil,
  ArrowLeft,
  GraduationCap,
  Plus,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { BlueprintSourceScope } from './BlueprintSourceScope';
import { BlueprintQuotaControls } from './BlueprintQuotaControls';
import { BlueprintProviderSummary } from './BlueprintProviderSummary';
import { GenerationDeficitReport } from './GenerationDeficitReport';
import { BlueprintService } from '../../../lib/study-plans/assessments/blueprintService';
import { QuestionEditor } from './QuestionEditor';
import { planQuotaSlots } from '../../../lib/study-plans/assessments/quotaPlanner';
import { runAssessmentGenerationCoordinator } from '../../../lib/study-plans/assessments/generationCoordinator';
import { performStudyAiPreflight, type StudyPreflightResult } from '../../../lib/study-plans/generation/preflight';
import { refreshCurriculumScope } from '../../../lib/study-plans/generation/curriculumPreflight';
import { GenerationPrivacySummary } from '../GenerationPrivacySummary';
import { studyQuestionTask } from '../../../lib/ai/tasks/definitions/studyQuestionTasks';
import { startExamAttempt } from '../../../api/exam-sessions';
import type {
  AssessmentConfigV1,
  BlueprintDetail,
  AssessmentQuestion,
  AssessmentQuestionRevision,
  QuotaSlot,
} from '../../../types/assessmentQuestions';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { StudyAiPreflight, StudyJobProgress } from '../../../lib/study-plans/generation/types';
import type { StudyPlanDetail } from '../../../types/learningPaths';

export interface AssessmentBuilderProps {
  planDetail?: StudyPlanDetail | null;
  blueprintRevisionId?: string | null;
  onClose: () => void;
  onPublished?: (detail: BlueprintDetail) => void;
  onOpenQuestionEditor?: (revisionId: string, questionId?: string) => void;
  onStartAssessment?: (attemptId: string) => void;
  isMobile?: boolean;
  /** C7-T03 diagnostic host callbacks: prefill mode/config without new destination. */
  initialMode?: AssessmentConfigV1['mode'];
  initialConfig?: Partial<AssessmentConfigV1>;
  onStartedAttempt?: (attemptId: string) => void;
  /** C7-T07 return context banner (no auto-start, plan unchanged). */
  returnContext?: import('../remediation/returnContext').ReassessmentReturnContext | null;
}

export type BuilderState = 'loading' | 'idle' | 'generating' | 'needs-review' | 'ready' | 'error';

function createManualQuestion(slot: QuotaSlot, points: number, sourceRefId?: string, learningObjectives: string[] = []): AssessmentQuestion {
  const sourceRefIds = sourceRefId ? [sourceRefId] : [];
  const common = {
    schemaVersion: 1 as const,
    prompt: 'Write the question prompt',
    difficulty: slot.difficulty,
    learningObjectives,
    sourceRefIds,
    explanation: 'Explain the answer using the selected source material.',
    maxPoints: points,
    applicationLevel: 'recall' as const,
    hints: [],
  };
  if (slot.kind === 'single-select') return {
    ...common, kind: slot.kind,
    options: [{ id: 'option_a', text: 'Option A' }, { id: 'option_b', text: 'Option B' }],
    correctOptionId: 'option_a',
  };
  if (slot.kind === 'multi-select') return {
    ...common, kind: slot.kind,
    options: [{ id: 'option_a', text: 'Option A' }, { id: 'option_b', text: 'Option B' }, { id: 'option_c', text: 'Option C' }],
    correctOptionIds: ['option_a', 'option_b'],
  };
  if (slot.kind === 'cloze') return {
    ...common, kind: slot.kind,
    prompt: 'Complete the sentence: {{blank_1}}.',
    segments: [{ kind: 'blank', blankId: 'blank_1' }],
    blanks: [{ id: 'blank_1', acceptedAnswers: ['answer'], caseSensitive: false }],
  };
  if (slot.kind === 'short-answer') {
    const keyFactId = 'fact_1';
    return {
      ...common, kind: slot.kind,
      referenceAnswer: 'Write the expected answer.',
      keyFacts: [{ id: keyFactId, text: 'Expected key fact', required: true }],
      acceptedAnswers: [],
      rubric: {
        schemaVersion: 1,
        expectedConcepts: [],
        gradingConstraints: [],
        criteria: [{ id: 'criterion_1', title: 'Key fact', assessmentInstruction: 'Identify the key fact.', weight: 100,
          grounding: sourceRefId ? 'source' : 'reasoning', sourceRefIds, keyFactIds: [keyFactId],
          levels: { '0': 'Absent', '1': 'Weak', '2': 'Partial', '3': 'Mostly correct', '4': 'Accurate' } }],
      },
    };
  }
  return {
    ...common, kind: slot.kind, maxPoints: Math.max(2, points),
    expectedReasoning: 'Write the expected reasoning and solution steps.',
    rubric: {
      schemaVersion: 1, expectedConcepts: [], gradingConstraints: [],
      criteria: ['Accuracy', 'Reasoning'].map((title, index) => ({
        id: `criterion_${index + 1}`, title, assessmentInstruction: `Assess ${title.toLowerCase()}.`, weight: 50,
        grounding: sourceRefId ? 'source' as const : 'reasoning' as const, sourceRefIds, keyFactIds: [],
        levels: { '0': 'Absent', '1': 'Weak', '2': 'Partial', '3': 'Mostly correct', '4': 'Accurate' },
      })),
    },
  };
}

export const AssessmentBuilder: React.FC<AssessmentBuilderProps> = ({
  planDetail,
  blueprintRevisionId: initialRevisionId,
  onClose,
  onPublished,
  onOpenQuestionEditor,
  onStartAssessment,
  isMobile = false,
  initialMode,
  initialConfig,
  onStartedAttempt,
  returnContext = null,
}) => {
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [title, setTitle] = useState('');
  const [config, setConfig] = useState<AssessmentConfigV1 | null>(null);
  const [state, setState] = useState<BuilderState>('loading');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [progress, setProgress] = useState<StudyJobProgress | null>(null);
  const [preflight, setPreflight] = useState<StudyAiPreflight | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [manualQuestion, setManualQuestion] = useState<AssessmentQuestionRevision | null | undefined>(undefined);
  const [isSavingQuestion, setIsSavingQuestion] = useState(false);
  const [cloudDisclosureAccepted, setCloudDisclosureAccepted] = useState(false);
  const [costConsentAccepted, setCostConsentAccepted] = useState(false);
  const [preflightRoute, setPreflightRoute] = useState<StudyPreflightResult['route'] | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const availableSourceRefs: StudySourceRefV1[] = Object.entries(planDetail?.sourceRefs || {}).flatMap(([id, resolution]) => {
    const scoped = detail?.revision.sourceScope.resolvedDocuments.find((doc) => doc.documentId === resolution.ref.documentId);
    if (resolution.status !== 'current' || !scoped || scoped.revision !== resolution.ref.revision ||
        (resolution.ref.extractId && !scoped.extractIds.includes(resolution.ref.extractId))) return [];
    return [{ ...resolution.ref, id }];
  });
  const nextManualSlot = config && detail
    ? planQuotaSlots(config, detail.revision.id).find((slot) => !detail.questions.some((question) => question.slotKey === slot.slotKey))
    : undefined;

  const saveManualQuestion = async (question: AssessmentQuestion) => {
    if (!detail || !config || detail.revision.state === 'ready') return;
    const existing = manualQuestion || undefined;
    const slot = existing
      ? planQuotaSlots(config, detail.revision.id).find((item) => item.slotKey === existing.slotKey)
      : nextManualSlot;
    if (!existing && !slot) throw new Error('All requested question slots are filled. Update the quota before adding another question.');
    if (slot && (question.kind !== slot.kind || question.difficulty !== slot.difficulty)) {
      throw new Error('Question kind and difficulty must match the assigned quota slot.');
    }
    const topicTarget = config.topicTargets[slot?.topicIndex ?? -1];
    setIsSavingQuestion(true);
    try {
      await BlueprintService.saveQuestionFromDomain({
        blueprintRevisionId: detail.revision.id,
        question,
        slotKey: existing?.slotKey ?? slot!.slotKey,
        questionId: existing?.questionId,
        targets: question.learningObjectives.map((objectiveText) => ({
          objectiveText,
          conceptId: topicTarget?.conceptId,
          conceptLabel: planDetail?.version.nodes.find((node) => node.nodeId === topicTarget?.nodeId)?.conceptLabel || objectiveText,
          nodeId: topicTarget?.nodeId,
        })),
      });
      const refreshed = await BlueprintService.getBlueprintRevision(detail.revision.id);
      setDetail(refreshed);
      setManualQuestion(undefined);
    } finally {
      setIsSavingQuestion(false);
    }
  };

  // Initialize or load blueprint revision
  const initBlueprint = useCallback(async () => {
    setState('loading');
    setErrorBanner(null);
    try {
      let loadedDetail: BlueprintDetail;
      if (initialRevisionId) {
        const fetched = await BlueprintService.getBlueprintRevision(initialRevisionId);
        loadedDetail = fetched;
        setDetail(fetched);
        setTitle(fetched.blueprint.title);
        setConfig(fetched.revision.config);
        setState(fetched.revision.state === 'ready' ? 'ready' : 'idle');
      } else {
        // Initialize new draft blueprint
        const planTitle = planDetail?.plan.title || 'General';
        const defaultTitle = `${planTitle} Examination`;
        const configOverride = initialConfig;

        const baseConfig: AssessmentConfigV1 = {
          schemaVersion: 1,
          mode: initialMode ?? 'exam',
          requestedCount: configOverride?.requestedCount ?? 10,
          typeWeights: configOverride?.typeWeights ?? {
            'single-select': 4,
            'multi-select': 2,
            cloze: 2,
            'short-answer': 2,
            essay: 1,
          },
          difficultyWeights: configOverride?.difficultyWeights ?? { 1: 1, 2: 3, 3: 4, 4: 2, 5: 1 },
          topicTargets: configOverride?.topicTargets ?? (planDetail?.version.nodes || []).map((n) => ({
            nodeId: n.nodeId,
            conceptId: n.conceptId || null,
            weight: 1,
          })),
          timeLimitSeconds: configOverride?.timeLimitSeconds ?? 1800,
          knowledgePolicy: configOverride?.knowledgePolicy ?? 'source-only',
          excludedQuestionFingerprints: configOverride?.excludedQuestionFingerprints ?? [],
          pointsByKind: configOverride?.pointsByKind ?? {
            'single-select': 1,
            'multi-select': 1,
            cloze: 1,
            'short-answer': 2,
            essay: 8,
          },
        };

        const created = await BlueprintService.createBlueprint({
          planId: planDetail?.plan.id ?? null,
          planVersionId: planDetail?.version.id ?? null,
          title: defaultTitle,
          config: baseConfig,
          sourceScope: planDetail?.version.sourceScope || {
            schemaVersion: 1,
            selected: { documentIds: [], extractIds: [], collectionIds: [], tagIds: [] },
            resolvedDocuments: [],
            frozenAt: new Date().toISOString(),
            indexCompleteness: 'complete',
            limitations: [],
          },
          sourceSnapshotHash: `sha256:${Date.now().toString(16)}`,
        });

        loadedDetail = created;
        setDetail(created);
        setTitle(created.blueprint.title);
        setConfig(created.revision.config);
        setState('idle');
      }

      // Inspect the live frozen scope before showing budget, route, or consent details.
      try {
        const frozenScope = loadedDetail.revision.sourceScope;
        const liveScope = frozenScope.resolvedDocuments.length
          ? await refreshCurriculumScope(frozenScope)
          : frozenScope;
        const docs = liveScope.resolvedDocuments.map((doc) => ({
          id: doc.documentId,
          isAiExcluded: doc.isAiExcluded,
          isLocalOnly: doc.isLocalOnly,
        }));
        const refs = Object.values(planDetail?.sourceRefs || {}).filter((resolution) =>
          resolution.status === 'current' && liveScope.resolvedDocuments.some((doc) =>
            doc.documentId === resolution.ref.documentId && doc.revision === resolution.ref.revision &&
            (!resolution.ref.extractId || doc.extractIds.includes(resolution.ref.extractId))));
        const res = await performStudyAiPreflight({
          primaryTask: studyQuestionTask as any,
          documents: docs,
          sourceExcerptCount: refs.length,
          plannedModelSteps: Math.ceil(loadedDetail.revision.config.requestedCount / (isMobile ? 3 : 6)),
          inspectOnly: true,
        });
        setPreflight(res.preflight);
        setPreflightRoute(res.route);
      } catch {
        setPreflight(null);
        setPreflightRoute(null);
      }
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to initialize assessment');
      setState('error');
    }
  }, [initialRevisionId, planDetail, initialConfig, isMobile]);

  useEffect(() => {
    initBlueprint();
  }, [initBlueprint]);

  // Save Draft modifications
  const handleSaveDraft = async () => {
    if (!detail || !config) return null;
    setIsSaving(true);
    setErrorBanner(null);
    try {
      const updated = await BlueprintService.saveBlueprintDraft({
        revisionId: detail.revision.id,
        expectedRevision: detail.blueprint.revision,
        title,
        config,
      });
      setDetail(updated);
      return updated;
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to save draft');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  // Run AI Question Generation
  const handleGenerate = async () => {
    if (!detail || !config || !preflight || !preflightRoute || !preflight.featureAllowed) return;
    const offDevice = preflight.sendsSourceOffDevice ||
      (typeof preflight.embeddingDestination === 'object' && preflight.embeddingDestination?.sendsOffDevice);
    if ((offDevice && !cloudDisclosureAccepted) || (preflight.billable && !costConsentAccepted)) return;
    setState('generating');
    setErrorBanner(null);
    setProgress({ completed: 0, total: 1, labelKey: 'Initializing generation…' });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // First persist current parameters to draft
      const savedDetail = await handleSaveDraft();
      if (!savedDetail) throw new Error('Draft could not be saved. Generation was not started.');

      const result = await runAssessmentGenerationCoordinator(
        {
          blueprintRevisionId: detail.revision.id,
          expectedRevision: savedDetail.blueprint.revision,
          planId: savedDetail.blueprint.planId,
          isMobile,
        },
        { ...preflight, cloudDisclosureAccepted, costConsentAccepted },
        {
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
        }
      );

      setDetail(result.blueprintDetail);
      if (result.deficitsCount > 0) {
        setState('needs-review');
      } else {
        setState('ready');
      }
    } catch (err: any) {
      if (err?.code === 'cancelled') {
        setErrorBanner('Generation cancelled. Partial drafts remain intact.');
      } else {
        setErrorBanner(err?.messageKey || err?.message || 'Generation failed');
      }
      setState('idle');
    } finally {
      abortControllerRef.current = null;
      setProgress(null);
    }
  };

  // Publish Blueprint Paper
  const handlePublish = async (acceptShortfall = false) => {
    if (!detail) return;
    setIsPublishing(true);
    setErrorBanner(null);
    try {
      const published = await BlueprintService.publishBlueprint(
        detail.revision.id,
        detail.blueprint.revision,
        acceptShortfall
      );
      setDetail(published);
      setState('ready');
      onPublished?.(published);
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to publish assessment');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleStartAttempt = async () => {
    if (!detail) return;
    try {
      const clientStartKey = `start_${detail.revision.id}_${Date.now()}`;
      const attemptDetail = await startExamAttempt({
        blueprintRevisionId: detail.revision.id,
        clientStartKey,
      });
      onStartAssessment?.(attemptDetail.attempt.id);
      onStartedAttempt?.(attemptDetail.attempt.id);
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to start assessment');
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {returnContext && (
        <p data-testid="builder-return-context" className="text-xs text-on-surface-variant">
          Follow-up context: plan {returnContext.planId ?? '—'} · gap {returnContext.gapId ?? '—'}. No
          automatic Start; published plan stays unchanged.
        </p>
      )}
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-3">
          <Button variant="text" size="iconSm" onClick={onClose} aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              <input
                type="text"
                value={title}
                disabled={state === 'generating' || state === 'ready'}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Assessment Title"
                className="text-lg font-bold text-surface-900 dark:text-surface-100 bg-transparent border-b border-transparent hover:border-surface-300 dark:hover:border-surface-600 focus:border-primary-500 outline-none px-1 py-0.5 rounded"
                aria-label="Assessment Title"
              />
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
              Source-Grounded Examination Paper Builder
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outlined"
            size="sm"
            onClick={handleSaveDraft}
            disabled={isSaving || state === 'generating' || state === 'ready'}
          >
            <FloppyDisk className="w-4 h-4 mr-1.5" />
            Save Draft
          </Button>

          {detail && state !== 'ready' && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => onOpenQuestionEditor
                ? onOpenQuestionEditor(detail.revision.id)
                : nextManualSlot && setManualQuestion(null)}
              disabled={state === 'generating' || (!onOpenQuestionEditor && !nextManualSlot)}
            >
              <Pencil className="w-4 h-4 mr-1.5" />
              Manual Question Editor ({detail.questions.length})
            </Button>
          )}
          {detail && state !== 'ready' && nextManualSlot && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => setManualQuestion(null)}
              disabled={state === 'generating'}
            >
              <Plus className="w-4 h-4 mr-1.5" /> Add Manual Question
            </Button>
          )}

          {preflight && (
            <Button
              variant="filled"
              size="sm"
              onClick={handleGenerate}
              disabled={state === 'generating' || state === 'ready' || !preflightRoute || !preflight.featureAllowed ||
                ((preflight.sendsSourceOffDevice || (typeof preflight.embeddingDestination === 'object' && preflight.embeddingDestination?.sendsOffDevice)) && !cloudDisclosureAccepted) ||
                (preflight.billable && !costConsentAccepted)}
            >
              <Sparkle className="w-4 h-4 mr-1.5" />
              Generate Questions
            </Button>
          )}

          {state !== 'ready' && detail && detail.questions.length > 0 && (
            <Button
              variant="filled"
              size="sm"
              onClick={() => handlePublish(false)}
              disabled={isPublishing || state === 'generating'}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" />
              Publish Paper
            </Button>
          )}

          {state === 'ready' && detail && (
            <Button
              variant="filled"
              size="sm"
              onClick={handleStartAttempt}
              className="bg-primary-600 hover:bg-primary-700 text-white"
            >
              <GraduationCap className="w-4 h-4 mr-1.5" />
              Start Assessment
            </Button>
          )}
        </div>
      </div>

      {/* Error / Notice Banner */}
      {errorBanner && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="p-1 rounded text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Generation Progress Overlay */}
      {state === 'generating' && progress && (
        <div className="p-5 rounded-2xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-primary-900 dark:text-primary-100 flex items-center gap-2">
              <Sparkle className="w-4 h-4 animate-spin text-primary-600" />
              Generating Questions…
            </span>
            <Button
              variant="outlined"
              size="sm"
              onClick={() => abortControllerRef.current?.abort()}
              className="text-xs border-primary-300 dark:border-primary-700"
            >
              Cancel
            </Button>
          </div>
          <div className="w-full h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
            <div
              className="h-full bg-primary-600 transition-all duration-300"
              style={{
                width: `${Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%`,
              }}
            />
          </div>
          <span className="text-xs text-primary-700 dark:text-primary-300 block">
            Step {progress.completed} of {progress.total} — {progress.labelKey}
          </span>
        </div>
      )}

      {/* Shortfall / Deficit Report */}
      {detail?.revision.quota && (
        <GenerationDeficitReport
          quotaReport={detail.revision.quota}
          onRetryDeficits={handleGenerate}
          onAcceptShortfall={() => handlePublish(true)}
        />
      )}

      {detail && detail.questions.length > 0 && (
        <section aria-label="Saved questions" className="space-y-2">
          <h2 className="text-sm font-semibold">Questions ({detail.questions.length}/{config?.requestedCount ?? detail.revision.config.requestedCount})</h2>
          {detail.questions.map((revision) => (
            <div key={revision.id} className="flex items-center justify-between gap-3 rounded-lg border border-surface-200 dark:border-surface-700 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{revision.question.prompt}</p>
                <p className="text-xs text-surface-500">{revision.question.kind} · slot {revision.slotKey}</p>
              </div>
              {detail.revision.state !== 'ready' && (
                <Button variant="outlined" size="sm" onClick={() => setManualQuestion(revision)} disabled={state === 'generating'}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Core Builder Columns */}
      {config && detail && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <BlueprintQuotaControls
              config={config}
              onChange={(updated) => setConfig(updated)}
              disabled={state === 'generating' || state === 'ready'}
            />
          </div>

          <div className="space-y-6">
            <BlueprintSourceScope
              sourceScope={detail.revision.sourceScope}
              snapshotHash={detail.revision.sourceSnapshotHash}
            />

            <BlueprintProviderSummary
              preflight={preflight}
              requestedCount={config.requestedCount}
              isMobile={isMobile}
            />
            <GenerationPrivacySummary
              preflight={preflight}
              purpose="assessment"
              cloudDisclosureAccepted={cloudDisclosureAccepted}
              onCloudDisclosureChange={setCloudDisclosureAccepted}
              costConsentAccepted={costConsentAccepted}
              onCostConsentChange={setCostConsentAccepted}
              disabled={state === 'generating'}
            />
          </div>
        </div>
      )}

      {detail && manualQuestion !== undefined && (() => {
        const slot: QuotaSlot | undefined = manualQuestion
          ? { slotKey: manualQuestion.slotKey, slotIndex: 0, topicIndex: 0, kind: manualQuestion.question.kind, difficulty: manualQuestion.question.difficulty }
          : nextManualSlot;
        if (!slot) return null;
        const initialQuestion = manualQuestion?.question ?? createManualQuestion(
          slot,
          config?.pointsByKind[slot.kind] ?? detail.revision.config.pointsByKind[slot.kind],
          availableSourceRefs[0]?.id,
          planDetail?.version.nodes.find((node) => node.nodeId === config?.topicTargets[slot.topicIndex]?.nodeId)?.learningObjectives ?? [],
        );
        return (
          <QuestionEditor
            key={manualQuestion?.id ?? `new-${slot.slotKey}`}
            initialQuestion={initialQuestion}
            availableSourceRefs={availableSourceRefs}
            onSave={saveManualQuestion}
            onClose={() => setManualQuestion(undefined)}
            isSaving={isSavingQuestion}
          />
        );
      })()}
    </div>
  );
};
