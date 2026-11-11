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
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { BlueprintSourceScope } from './BlueprintSourceScope';
import { BlueprintQuotaControls } from './BlueprintQuotaControls';
import { BlueprintProviderSummary } from './BlueprintProviderSummary';
import { GenerationDeficitReport } from './GenerationDeficitReport';
import { BlueprintService } from '../../../lib/study-plans/assessments/blueprintService';
import { runAssessmentGenerationCoordinator } from '../../../lib/study-plans/assessments/generationCoordinator';
import { performStudyAiPreflight } from '../../../lib/study-plans/generation/preflight';
import { studyQuestionTask } from '../../../lib/ai/tasks/definitions/studyQuestionTasks';
import { startExamAttempt } from '../../../api/exam-sessions';
import type {
  AssessmentConfigV1,
  BlueprintDetail,
} from '../../../types/assessmentQuestions';
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

  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize or load blueprint revision
  const initBlueprint = useCallback(async () => {
    setState('loading');
    setErrorBanner(null);
    try {
      // 1. Preflight provider check
      try {
        const docs =
          planDetail?.version.sourceScope.resolvedDocuments.map((d) => ({
            id: d.documentId,
            isAiExcluded: d.isAiExcluded,
            isLocalOnly: d.isLocalOnly,
          })) || [];
        const res = await performStudyAiPreflight({
          primaryTask: studyQuestionTask as any,
          documents: docs,
          sourceExcerptCount: 10,
          plannedModelSteps: 2,
        });
        setPreflight(res.preflight);
      } catch {
        setPreflight(null);
      }

      // 2. Fetch existing or create draft
      if (initialRevisionId) {
        const fetched = await BlueprintService.getBlueprintRevision(initialRevisionId);
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

        setDetail(created);
        setTitle(created.blueprint.title);
        setConfig(created.revision.config);
        setState('idle');      }
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to initialize assessment');
      setState('error');
    }
  }, [initialRevisionId, planDetail]);

  useEffect(() => {
    initBlueprint();
  }, [initBlueprint]);

  // Save Draft modifications
  const handleSaveDraft = async () => {
    if (!detail || !config) return;
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
    } catch (err: any) {
      setErrorBanner(err?.messageKey || err?.message || 'Failed to save draft');
    } finally {
      setIsSaving(false);
    }
  };

  // Run AI Question Generation
  const handleGenerate = async () => {
    if (!detail || !config || !preflight) return;
    setState('generating');
    setErrorBanner(null);
    setProgress({ completed: 0, total: 1, labelKey: 'Initializing generation…' });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // First persist current parameters to draft
      await handleSaveDraft();

      const result = await runAssessmentGenerationCoordinator(
        {
          blueprintRevisionId: detail.revision.id,
          expectedRevision: detail.blueprint.revision,
          planId: detail.blueprint.planId,
          isMobile,
        },
        preflight,
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

          {onOpenQuestionEditor && detail && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => onOpenQuestionEditor(detail.revision.id)}
              disabled={state === 'generating'}
            >
              <Pencil className="w-4 h-4 mr-1.5" />
              Manual Question Editor ({detail.questions.length})
            </Button>
          )}

          {preflight && (
            <Button
              variant="filled"
              size="sm"
              onClick={handleGenerate}
              disabled={state === 'generating' || state === 'ready'}
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
          </div>
        </div>
      )}
    </div>
  );
};
