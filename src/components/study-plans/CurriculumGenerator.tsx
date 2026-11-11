/**
 * Curriculum Generation Wizard & Modal Aggregate Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2, §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React, { useState, useEffect, useId, useRef } from 'react';
import {
  Sparkle,
  ShieldCheck,
  Warning,
  X,
  Play,
  ArrowRight,
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
import { countIndexedCurriculumSources, prepareCurriculumPreflight } from '../../lib/study-plans/generation/curriculumPreflight';
import { isUsableStudyModel } from '../../lib/study-plans/generation/preflight';
import { studyErrorMessage } from '../../lib/study-plans/studyErrorMessage';
import { useLLMProvidersStore } from '../../stores/llmProvidersStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { PROVIDER_CONFIGS } from '../../api/llm';
import type { HydratedEvidenceResult } from '../../lib/study-plans/generation/evidence';
import type {
  StudyPlanDetail,
} from '../../types/learningPaths';
import type {
  CurriculumGenerationRequest,
  CurriculumExecutionStats,
  StudyAiPreflight,
  StudyJobProgress,
  StudyGenerationJob,
} from '../../lib/study-plans/generation/types';
import type { MergeCurriculumResult } from '../../lib/study-plans/generation/merge';

export interface CurriculumGeneratorProps {
  planDetail: StudyPlanDetail;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedDetail: StudyPlanDetail) => void;
  jobController?: StudyJobController;
  initialMode?: GeneratorMode;
  recoveryJob?: StudyGenerationJob;
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
  initialMode = 'ai',
  recoveryJob,
  diagnosticSlot,
}) => {
  const publishVersionAction = useLearningPathsStore((s) => s.publishVersion);
  const discardDraftAction = useLearningPathsStore((s) => s.discardDraft);

  const [mode, setMode] = useState<GeneratorMode>(initialMode);
  const [step, setStep] = useState<GeneratorStep>('configure');

  // Plan detail state
  const [currentPlanDetail, setCurrentPlanDetail] = useState<StudyPlanDetail>(initialPlanDetail);
  const [mergeResult, setMergeResult] = useState<MergeCurriculumResult | null>(null);

  // Preflight state
  const providers = useLLMProvidersStore((state) => state.providers);
  const embeddingSettings = useSettingsStore((state) => state.settings.embedding);
  const aiSettings = useSettingsStore((state) => state.settings.ai);
  const priorPreflight = recoveryJob?.preflight as StudyAiPreflight | undefined;
  const [selectedConfigId, setSelectedConfigId] = useState(priorPreflight?.modelSelection ?? '');
  const [indexedSourceCount, setIndexedSourceCount] = useState<number | null>(null);
  const [execution, setExecution] = useState<CurriculumExecutionStats>();
  const [retrieval, setRetrieval] = useState<HydratedEvidenceResult['retrieval']>();
  const [preflight, setPreflight] = useState<StudyAiPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [cloudDisclosureAccepted, setCloudDisclosureAccepted] = useState(false);
  const [costConsentAccepted, setCostConsentAccepted] = useState(false);

  // Job progress state
  const [jobStatus, setJobStatus] = useState<GeneratorStatus>('idle');
  const [jobProgress, setJobProgress] = useState<StudyJobProgress | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  // Error & action loading
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const titleId = useId();
  const descId = useId();
  const closeWhenIdle = () => {
    if (jobStatus !== 'running' && !isAccepting && !isDiscarding) onClose();
  };
  const dialogRef = useDialogFocus(isOpen, closeWhenIdle);
  useEffect(() => () => abortCtrlRef.current?.abort(), []);

  const scope = currentPlanDetail.version.sourceScope;
  const hasSources = scope.resolvedDocuments.length > 0 ||
    Object.values(scope.selected).some((ids) => ids.length > 0);
  const hasAiExcludedDoc = scope.resolvedDocuments.some((doc) => doc.isAiExcluded);
  const usableProviders = providers.filter(isUsableStudyModel);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setPreflight(null);
    setPreflightError(null);
    setCloudDisclosureAccepted(false);
    setCostConsentAccepted(false);
    setIndexedSourceCount(null);
    if (!isOpen || mode !== 'ai' || !hasSources) {
      setIsPreflighting(false);
      return;
    }

    let stale = false;
    setIsPreflighting(true);
    void prepareCurriculumPreflight(scope, selectedConfigId || undefined).then(
      async (result) => {
        if (stale) return;
        setPreflight(result.preflight);
        setIsPreflighting(false);
        const count = await countIndexedCurriculumSources(result.preflight.documentIds);
        if (!stale) setIndexedSourceCount(count);
      },
      (error: unknown) => {
        if (stale) return;
        setPreflightError(studyErrorMessage(error, 'Could not inspect the generation configuration. Check your AI settings or try Source Outline.'));
        setIsPreflighting(false);
      },
    );
    return () => { stale = true; };
  }, [isOpen, mode, hasSources, scope, selectedConfigId, providers, embeddingSettings, aiSettings]);

  const offDevice = preflight?.sendsSourceOffDevice ||
    (typeof preflight?.embeddingDestination === 'object' && preflight.embeddingDestination?.sendsOffDevice);
  const canGenerate = hasSources && !isPreflighting && (
    mode === 'rules-only' || !!preflight &&
    (!offDevice || cloudDisclosureAccepted) &&
    (!preflight.billable || costConsentAccepted)
  );

  // Execute Generation
  const handleStartGeneration = async () => {
    if (!canGenerate || abortCtrlRef.current) return;
    setExecutionError(null);
    setJobProgress(null);
    setRetrieval(undefined);
    setExecution(undefined);
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
        setExecutionError(studyErrorMessage(err, 'Could not build the outline. Open the saved draft and try again.'));
      }
      return;
    }

    if (!preflight) return;
    const abortController = new AbortController();
    abortCtrlRef.current = abortController;
    try {
      const authorized = {
        ...preflight,
        cloudDisclosureAccepted,
        costConsentAccepted,
      };
      const options = {
        signal: abortController.signal,
        onProgress: setJobProgress,
      };
      const res = recoveryJob
        ? await jobController.resumeJob(recoveryJob.id, request, authorized, options)
        : await jobController.startCurriculumJob(request, authorized, options);
      if (abortController.signal.aborted) return;
      setCurrentPlanDetail(res.planDetail);
      setMergeResult(res.mergeResult);
      setRetrieval(res.retrieval);
      setExecution(res.execution);
      setStep('preview');
      setJobStatus('completed');
    } catch (error: unknown) {
      setJobStatus(abortController.signal.aborted ? 'cancelled' : 'failed');
      setExecutionError(studyErrorMessage(error, abortController.signal.aborted
        ? 'Generation was cancelled. Any saved draft changes are available in the plan editor.'
        : 'Generation stopped. Open the saved draft to review any progress, then try again.'));
    } finally {
      abortCtrlRef.current = null;
    }
  };

  const handleCancel = () => {
    abortCtrlRef.current?.abort();
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
    } catch (err: any) {
      setExecutionError(studyErrorMessage(err, 'Could not publish the curriculum. Your draft is still available.'));
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
    } catch (err: any) {
      setExecutionError(studyErrorMessage(err, 'Could not discard the draft. Try again.'));
    } finally {
      setIsDiscarding(false);
    }
  };

  const handleEditInEditor = () => {
    onSuccess(currentPlanDetail);
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
            onClick={closeWhenIdle}
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
                aria-pressed={mode === 'ai'}
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
                aria-pressed={mode === 'rules-only'}
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
                  Builds an outline from confirmed library concepts and document titles. It uses no AI or passage retrieval.
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

            {mode === 'ai' && hasSources && (
              <div className="space-y-4">
                <label className="block space-y-1 text-sm font-medium">
                  <span>Generation model</span>
                  <select
                    value={selectedConfigId}
                    onChange={(event) => setSelectedConfigId(event.target.value)}
                    className="block w-full rounded-lg border border-border bg-surface-50 px-3 py-2.5 text-sm dark:bg-surface-800"
                  >
                    <option value="">Use app default</option>
                    {selectedConfigId && !usableProviders.some((config) => config.id === selectedConfigId) && (
                      <option value={selectedConfigId} disabled>Previously selected model is unavailable</option>
                    )}
                    {usableProviders.map((config) => (
                      <option key={config.id} value={config.id}>
                        {PROVIDER_CONFIGS[config.provider].name} · {config.name} · {config.model}
                      </option>
                    ))}
                  </select>
                </label>
                {isPreflighting && <p role="status" className="text-sm text-muted-foreground">Checking model, sources, and privacy…</p>}
                <GenerationPrivacySummary
                  preflight={preflight}
                  indexedSourceCount={indexedSourceCount}
                  cloudDisclosureAccepted={cloudDisclosureAccepted}
                  onCloudDisclosureChange={setCloudDisclosureAccepted}
                  costConsentAccepted={costConsentAccepted}
                  onCostConsentChange={setCostConsentAccepted}
                  disabled={isPreflighting}
                />
              </div>
            )}
            <p className="text-sm text-muted-foreground">You can close this window and return to the saved draft.</p>

            {/* Footer Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
              <Button variant="text" onClick={closeWhenIdle}>
                Cancel
              </Button>
              <Button
                variant="filled"
                onClick={handleStartGeneration}
                disabled={!canGenerate}
              >
                <Play size={16} />
                <span>
                  {mode === 'ai' ? recoveryJob ? 'Resume AI Generation' : 'Start AI Generation' : 'Build Deterministic Outline'}
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
              onCancel={abortCtrlRef.current ? handleCancel : undefined}
            />

            {executionError && (
              <div className="space-y-3">
                <GenerationIssueList generalError={executionError} />
                <div className="flex justify-end gap-2">
                  <Button variant="text" onClick={onClose}>
                    Open Saved Draft
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview & Acceptance */}
        {step === 'preview' && retrieval && (
          <details className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Generation details</summary>
            <p className="mt-2">
              {retrieval.mode === 'semantic' ? 'Semantic retrieval'
                : retrieval.mode === 'lexicalOnly' ? 'Lexical retrieval'
                : retrieval.mode === 'mixed' ? 'Semantic and lexical retrieval' : 'Retrieval unavailable'}
              {retrieval.embeddingModels.length ? ` · ${retrieval.embeddingModels.join(', ')}` : ''}
            </p>
            <p>{retrieval.verifiedPassages} verified passages from {retrieval.documentsWithEvidence} of {currentPlanDetail.version.sourceScope.resolvedDocuments.length} selected documents.</p>
            <p>{retrieval.queryCount} retrieval queries. {retrieval.failedQueries} failed.</p>
            {execution && (
              <div className="mt-2">
                <p>{execution.modelCalls} model calls, including {execution.corrections} corrections. {Math.round(execution.durationMs / 1000)} seconds.</p>
                {execution.responsesWithUsage > 0 && (
                  <p>{execution.reportedInputTokens.toLocaleString()} input and {execution.reportedOutputTokens.toLocaleString()} output tokens reported for {execution.responsesWithUsage} of {execution.modelCalls} calls.</p>
                )}
              </div>
            )}
            <p className="text-muted-foreground">Retrieval searches for relevant passages and can miss sections of the selected material.</p>
          </details>
        )}
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
