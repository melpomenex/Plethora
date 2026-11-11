/**
 * Curriculum Generation Wizard & Modal Aggregate Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2, §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import {
  Sparkle,
  ShieldCheck,
  Warning,
  X,
  Play,
  ArrowRight,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import { dialogSurface, useDialogFocus } from '../md3/Dialog';
import { GenerationPrivacySummary } from './GenerationPrivacySummary';
import { GenerationProgress, type GeneratorStatus } from './GenerationProgress';
import { CurriculumDraftPreview } from './CurriculumDraftPreview';
import { GenerationIssueList } from './GenerationIssueList';
import { useLearningPathsStore } from '../../stores/learningPathsStore';
import {
  studyJobController,
  StudyJobController,
} from '../../lib/study-plans/generation/jobController';
import { runNoAiCurriculumCoordinator } from '../../lib/study-plans/generation/noAiCoordinator';
import { performStudyAiPreflight } from '../../lib/study-plans/generation/preflight';
import { curriculumDecomposeTask } from '../../lib/ai/tasks/definitions/curriculumTasks';
import { StudyApiError } from '../../api/study-plans';
import type {
  StudyPlanDetail,
} from '../../types/learningPaths';
import type {
  CurriculumGenerationRequest,
  StudyAiPreflight,
  StudyJobProgress,
} from '../../lib/study-plans/generation/types';
import type { MergeCurriculumResult } from '../../lib/study-plans/generation/merge';
import type { StudyPrivacyDocument } from '../../lib/study-plans/generation/privacy';

export interface CurriculumGeneratorProps {
  planDetail: StudyPlanDetail;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedDetail: StudyPlanDetail) => void;
  jobController?: StudyJobController;
  /** C7-T03 optional diagnostic host slot rendered in preview step. */
  diagnosticSlot?: React.ReactNode;
}

type GeneratorMode = 'ai' | 'rules-only';
type GeneratorStep = 'configure' | 'generating' | 'preview';

export const CurriculumGenerator: React.FC<CurriculumGeneratorProps> = ({
  planDetail: initialPlanDetail,
  isOpen,
  onClose,
  onSuccess,
  jobController = studyJobController,
  diagnosticSlot,
}) => {
  const publishVersionAction = useLearningPathsStore((s) => s.publishVersion);
  const discardDraftAction = useLearningPathsStore((s) => s.discardDraft);

  const [mode, setMode] = useState<GeneratorMode>('ai');
  const [step, setStep] = useState<GeneratorStep>('configure');

  // Plan detail state
  const [currentPlanDetail, setCurrentPlanDetail] = useState<StudyPlanDetail>(initialPlanDetail);
  const [mergeResult, setMergeResult] = useState<MergeCurriculumResult | null>(null);

  // Preflight state
  const [preflight, setPreflight] = useState<StudyAiPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [cloudDisclosureAccepted, setCloudDisclosureAccepted] = useState(false);
  const [costConsentAccepted, setCostConsentAccepted] = useState(false);

  // Job progress state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<GeneratorStatus>('idle');
  const [jobProgress, setJobProgress] = useState<StudyJobProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Error & action loading
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const titleId = useId();
  const descId = useId();
  const dialogRef = useDialogFocus(isOpen, onClose);

  // Derive documents in scope
  const resolvedDocs: StudyPrivacyDocument[] =
    currentPlanDetail.version.sourceScope.resolvedDocuments.map((d) => ({
      id: d.documentId,
      title: d.title,
      isAiExcluded: d.isAiExcluded,
      isLocalOnly: d.isLocalOnly,
    }));

  const selectedDocIds = currentPlanDetail.version.sourceScope.selected.documentIds;
  const hasSources = resolvedDocs.length > 0 || selectedDocIds.length > 0;
  const hasAiExcludedDoc = resolvedDocs.some((d) => d.isAiExcluded);

  // Preflight runner
  const runPreflight = useCallback(async () => {
    if (!hasSources) return;
    setIsPreflighting(true);
    setPreflightError(null);

    const docsToPreflight = resolvedDocs.length > 0
      ? resolvedDocs
      : selectedDocIds.map((id) => ({ id, isAiExcluded: false, isLocalOnly: false }));

    try {
      const res = await performStudyAiPreflight({
        primaryTask: curriculumDecomposeTask as any,
        documents: docsToPreflight,
        sourceExcerptCount: 12,
        plannedModelSteps: 2,
        cloudDisclosureAccepted,
        costConsentAccepted,
      });
      setPreflight(res.preflight);
    } catch (err: any) {
      if (err instanceof StudyApiError) {
        if (err.code === 'source_ai_excluded') {
          setPreflightError('Selected source material is excluded from AI processing.');
        } else if (err.code === 'provider_unavailable') {
          setPreflightError('No AI provider configured. You can use the Deterministic Source Outline instead.');
        } else {
          setPreflightError(err.messageKey || err.message || 'AI preflight failed');
        }
      } else {
        setPreflightError(err?.message || 'Failed to initialize AI preflight');
      }
    } finally {
      setIsPreflighting(false);
    }
  }, [hasSources, resolvedDocs, selectedDocIds, cloudDisclosureAccepted, costConsentAccepted]);

  useEffect(() => {
    if (isOpen && mode === 'ai') {
      runPreflight();
    }
  }, [isOpen, mode, runPreflight]);

  // Execute Generation
  const handleStartGeneration = async () => {
    setExecutionError(null);
    setStep('generating');
    setJobStatus('running');

    const request: CurriculumGenerationRequest = {
      planId: currentPlanDetail.plan.id,
      baseVersionId: currentPlanDetail.version.id,
      sourceScope: currentPlanDetail.version.sourceScope,
      depth: currentPlanDetail.plan.depth,
      knowledgePolicy: 'source-only',
      rulesOnly: mode === 'rules-only',
      priorEvidence: null,
      goal: currentPlanDetail.plan.goal,
    };

    if (mode === 'rules-only') {
      try {
        setJobProgress({
          completed: 1,
          total: 2,
          labelKey: 'study_generation.step.decompose',
        });

        const res = await runNoAiCurriculumCoordinator(request);
        setCurrentPlanDetail(res.planDetail);
        setMergeResult(res.mergeResult);
        setStep('preview');
        setJobStatus('completed');
      } catch (err: any) {
        setJobStatus('failed');
        setExecutionError(err?.messageKey || err?.message || 'Rules-only generation failed');
      }
      return;
    }

    // AI Generation Mode
    if (!preflight) {
      setExecutionError('AI preflight check must complete before starting generation.');
      setJobStatus('failed');
      return;
    }

    try {
      const abortController = new AbortController();
      abortCtrlRef.current = abortController;

      const res = await jobController.startCurriculumJob(request, preflight, {
        signal: abortController.signal,
        onProgress: (prog) => setJobProgress(prog),
      });

      setActiveJobId(res.jobId);
      setCurrentPlanDetail(res.planDetail);
      setMergeResult(res.mergeResult);
      setStep('preview');
      setJobStatus('completed');
    } catch (err: any) {
      setJobStatus('failed');
      setExecutionError(err?.messageKey || err?.message || 'Curriculum generation failed');
    }
  };

  const handlePause = async () => {
    if (!activeJobId) return;
    try {
      jobController.pauseJob(activeJobId);
      setJobStatus('paused');
    } catch (err: any) {
      setExecutionError(err?.messageKey || 'Failed to pause job');
    }
  };

  const handleResume = async () => {
    if (!activeJobId || !preflight) return;
    try {
      setJobStatus('running');
      const abortController = new AbortController();
      abortCtrlRef.current = abortController;

      const res = await jobController.resumeJob(activeJobId, {
        planId: currentPlanDetail.plan.id,
        baseVersionId: currentPlanDetail.version.id,
        sourceScope: currentPlanDetail.version.sourceScope,
        depth: currentPlanDetail.plan.depth,
        knowledgePolicy: 'source-only',
        rulesOnly: false,
        priorEvidence: null,
        goal: currentPlanDetail.plan.goal,
      }, preflight, {
        signal: abortController.signal,
        onProgress: (prog) => setJobProgress(prog),
      });

      setCurrentPlanDetail(res.planDetail);
      setMergeResult(res.mergeResult);
      setStep('preview');
      setJobStatus('completed');
    } catch (err: any) {
      setExecutionError(err?.messageKey || 'Failed to resume job');
    }
  };

  const handleCancel = async () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    if (activeJobId) {
      setIsCancelling(true);
      setJobStatus('cancelling');
      try {
        await jobController.cancelJob(activeJobId);
      } catch (err: any) {
        setExecutionError(err?.messageKey || 'Failed to cancel job');
      } finally {
        setIsCancelling(false);
      }
    }
    setStep('configure');
    setJobStatus('idle');
  };

  const handleAcceptPublish = async () => {
    setIsAccepting(true);
    setExecutionError(null);
    try {
      const published = await publishVersionAction(
        currentPlanDetail.plan.id,
        currentPlanDetail.version.id,
        currentPlanDetail.plan.revision
      );
      onSuccess(published);
      onClose();
    } catch (err: any) {
      setExecutionError(err?.messageKey || err?.message || 'Failed to publish curriculum version');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDiscard = async () => {
    setIsDiscarding(true);
    setExecutionError(null);
    try {
      const reverted = await discardDraftAction(
        currentPlanDetail.plan.id,
        currentPlanDetail.plan.revision
      );
      onSuccess(reverted);
      onClose();
    } catch (err: any) {
      setExecutionError(err?.messageKey || err?.message || 'Failed to discard draft');
    } finally {
      setIsDiscarding(false);
    }
  };

  const handleEditInEditor = () => {
    onSuccess(currentPlanDetail);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={dialogRef}
        className={`${dialogSurface} max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-3xl p-6 space-y-6 shadow-2xl`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center">
              <Sparkle size={18} />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-surface-900 dark:text-surface-100">
                Generate Curriculum
              </h2>
              <p id={descId} className="text-xs text-surface-500">
                Ground your study plan in selected library material with AI or deterministic rules.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close generator"
            disabled={jobStatus === 'running'}
            className="p-1.5 rounded-full hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step 1: Configure & Preflight */}
        {step === 'configure' && (
          <div className="space-y-6">
            {/* Mode selection tabs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('ai')}
                disabled={hasAiExcludedDoc}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  mode === 'ai'
                    ? 'border-primary-500 bg-primary-500/10 text-primary-900 dark:text-primary-100 ring-2 ring-primary-500/20'
                    : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800'
                } ${hasAiExcludedDoc ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <Sparkle size={18} className="text-primary-500" />
                  <span>Generate with AI</span>
                </div>
                <p className="text-xs text-surface-500">
                  Decomposes source text into topics, objectives, and prerequisite dependencies using
                  your selected AI model.
                </p>
                {hasAiExcludedDoc && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 font-semibold">
                    Disabled: One or more selected sources are marked as AI-excluded.
                  </p>
                )}
              </button>

              <button
                type="button"
                onClick={() => setMode('rules-only')}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  mode === 'rules-only'
                    ? 'border-blue-500 bg-blue-500/10 text-blue-900 dark:text-blue-100 ring-2 ring-blue-500/20'
                    : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <ShieldCheck size={18} className="text-blue-500" />
                  <span>Source Outline (No AI)</span>
                </div>
                <p className="text-xs text-surface-500">
                  Builds a deterministic outline from confirmed library concepts and document
                  structure without calling any AI model.
                </p>
              </button>
            </div>

            {/* Error notifications */}
            {(preflightError || executionError) && (
              <GenerationIssueList generalError={preflightError || executionError} />
            )}

            {/* No sources error */}
            {!hasSources && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <Warning size={16} className="flex-shrink-0" />
                <span>
                  No documents selected in source scope. Please add at least one document to ground
                  the curriculum.
                </span>
              </div>
            )}

            {/* Privacy Summary for AI mode */}
            {mode === 'ai' && hasSources && (
              <GenerationPrivacySummary
                preflight={preflight}
                cloudDisclosureAccepted={cloudDisclosureAccepted}
                onCloudDisclosureChange={setCloudDisclosureAccepted}
                costConsentAccepted={costConsentAccepted}
                onCostConsentChange={setCostConsentAccepted}
                disabled={isPreflighting}
              />
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
              <Button variant="text" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="filled"
                onClick={handleStartGeneration}
                disabled={
                  !hasSources ||
                  isPreflighting ||
                  (mode === 'ai' &&
                    (!preflight ||
                      (preflight.sendsSourceOffDevice && !cloudDisclosureAccepted) ||
                      (preflight.billable && !costConsentAccepted)))
                }
              >
                <Play size={16} />
                <span>
                  {mode === 'ai' ? 'Start AI Generation' : 'Build Deterministic Outline'}
                </span>
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Generation In-Progress */}
        {step === 'generating' && (
          <div className="space-y-4">
            <GenerationProgress
              progress={jobProgress}
              status={jobStatus}
              topicCount={currentPlanDetail.version.nodes.length}
              onCancel={handleCancel}
              onPause={handlePause}
              onResume={handleResume}
              isCancelling={isCancelling}
            />

            {executionError && (
              <div className="space-y-3">
                <GenerationIssueList generalError={executionError} />
                <div className="flex justify-end gap-2">
                  <Button variant="text" onClick={() => setStep('configure')}>
                    Back to Configuration
                  </Button>
                  <Button variant="filled" onClick={handleStartGeneration}>
                    <ArrowsClockwise size={15} />
                    <span>Retry Generation</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview & Acceptance */}
        {step === 'preview' && (
          <>
            {diagnosticSlot}
            <CurriculumDraftPreview
              planDetail={currentPlanDetail}
              mergeResult={mergeResult}
              isRulesOnly={mode === 'rules-only'}
              onAccept={handleAcceptPublish}
              onDiscard={handleDiscard}
              onEditInEditor={handleEditInEditor}
              isAccepting={isAccepting}
              isDiscarding={isDiscarding}
              error={executionError}
            />
          </>
        )}
      </div>
    </div>
  );
};
