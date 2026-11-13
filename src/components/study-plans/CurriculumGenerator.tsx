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
import { countIndexedCurriculumSources, prepareCurriculumPreflight, prepareModelOnlyCurriculumPreflight } from '../../lib/study-plans/generation/curriculumPreflight';
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
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface CurriculumGeneratorProps {
  planDetail: StudyPlanDetail;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedDetail: StudyPlanDetail) => void;
  jobController?: StudyJobController;
  initialMode?: GeneratorMode;
  recoveryJob?: StudyGenerationJob;
  /** Opens a saved source reference for exact navigation (PDF page/quote, video timestamp). */
  onOpenSource?: (refId: string) => void;
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
  onOpenSource,
  diagnosticSlot,
}) => {
    useI18n();
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
  const authority = currentPlanDetail.version.knowledgeAuthority;
  const isModelOnly = authority.kind === 'model-only';
  const hasSources = !isModelOnly && !!scope && (scope.resolvedDocuments.length > 0 ||
    Object.values(scope.selected).some((ids) => ids.length > 0));
  const hasAiExcludedDoc = !isModelOnly && (scope?.resolvedDocuments.some((doc) => doc.isAiExcluded) ?? false);
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
    if (!isOpen || mode !== 'ai' || (isModelOnly ? false : !hasSources || !scope)) {
      setIsPreflighting(false);
      return;
    }

    let stale = false;
    setIsPreflighting(true);
    const preflightCall = isModelOnly
      ? prepareModelOnlyCurriculumPreflight(selectedConfigId || undefined)
      : prepareCurriculumPreflight(scope!, selectedConfigId || undefined);
    void preflightCall.then(
      async (result) => {
        if (stale) return;
        setPreflight(result.preflight);
        setIsPreflighting(false);
        if (!isModelOnly) {
          const count = await countIndexedCurriculumSources(result.preflight.documentIds);
          if (!stale) setIndexedSourceCount(count);
        }
      },
      (error: unknown) => {
                if (stale) return;
        setPreflightError(studyErrorMessage(error, translateRecentFeature("studyPlans.ui.could-not-inspect-the-genera.8c8867d0")));
        setIsPreflighting(false);
      },
    );
    return () => { stale = true; };
  }, [isOpen, mode, hasSources, scope, selectedConfigId, providers, embeddingSettings, aiSettings, isModelOnly]);

  const offDevice = preflight?.sendsSourceOffDevice ||
    (typeof preflight?.embeddingDestination === 'object' && preflight.embeddingDestination?.sendsOffDevice);
  const canGenerate = (isModelOnly || hasSources) && !isPreflighting && (
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
      sourceScope: currentPlanDetail.version.sourceScope!,
      depth: currentPlanDetail.plan.depth,
      knowledgePolicy: currentPlanDetail.version.knowledgeAuthority.kind === 'library'
        ? currentPlanDetail.version.knowledgeAuthority.policy
        : 'source-only',
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
        setExecutionError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.could-not-build-the-outline-.ec22c369")));
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
      if (isModelOnly) {
        const modelOnlyRequest = {
          planId: currentPlanDetail.plan.id,
          baseVersionId: currentPlanDetail.version.id,
          depth: currentPlanDetail.plan.depth,
        };
        const isModelOnlyResume = recoveryJob?.preflight &&
          (recoveryJob.preflight as StudyAiPreflight).executionBranch === 'model-only';
        const res = isModelOnlyResume
          ? await jobController.resumeModelOnlyJob(recoveryJob!.id, modelOnlyRequest, authorized, options)
          : await jobController.startModelOnlyCurriculumJob(modelOnlyRequest, authorized, options);
        if (abortController.signal.aborted) return;
        setCurrentPlanDetail(res.planDetail);
        setMergeResult(res.mergeResult);
        setExecution(res.execution);
        setStep('preview');
        setJobStatus('completed');
        return;
      }
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
      setExecutionError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.could-not-publish-the-curric.36484aef")));
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
      setExecutionError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.could-not-discard-the-draft-.ec65c4eb")));
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
      className="adaptive-dialog-layer bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        className={`${dialogSurface} adaptive-dialog-panel adaptive-dialog-centered study-plans-dialog-wide max-w-4xl w-full overflow-y-auto rounded-3xl p-4 sm:p-6 space-y-6 shadow-2xl`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center">
              <Sparkle size={18} />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {translateRecentFeature("studyPlans.ui.generate-curriculum.e5c7d8bf")}</h2>
              <p id={descId} className="text-xs text-surface-500">
                {translateRecentFeature("studyPlans.ui.ground-your-study-plan-in-se.458a985f")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeWhenIdle}
            aria-label={translateRecentFeature("studyPlans.ui.close-generator.ce3a9e44")}
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
                  <span>{translateRecentFeature("studyPlans.ui.generate-with-ai.65a96811")}</span>
                </div>
                <p className="text-xs text-surface-500">
                  {isModelOnly
                    ? translateRecentFeature("studyPlans.ui.builds-an-unverified-study-p.a95af898")
                    : translateRecentFeature("studyPlans.ui.decomposes-source-text-into-.cb3acd18")}
                </p>
                {hasAiExcludedDoc && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 font-semibold">
                    {translateRecentFeature("studyPlans.ui.disabled-one-or-more-selecte.3ec5c23e")}</p>
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
                  <span>{translateRecentFeature("studyPlans.ui.source-outline-no-ai.2dd5747a")}</span>
                </div>
                <p className="text-xs text-surface-500">
                  {translateRecentFeature("studyPlans.ui.builds-an-outline-from-confi.59a740ac")}</p>
              </button>
            </div>

            {/* Error notifications */}
            {(preflightError || executionError) && (
              <GenerationIssueList generalError={preflightError || executionError} />
            )}

            {/* No sources error */}
            {!isModelOnly && !hasSources && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <Warning size={16} className="flex-shrink-0" />
                <span>
                  {translateRecentFeature("studyPlans.ui.no-documents-selected-in-sou.b85bd66b")}</span>
              </div>
            )}

            {mode === 'ai' && (hasSources || isModelOnly) && (
              <div className="space-y-4">
                <label className="block space-y-1 text-sm font-medium">
                  <span>{translateRecentFeature("studyPlans.ui.generation-model.ba5bde5b")}</span>
                  <select
                    value={selectedConfigId}
                    onChange={(event) => setSelectedConfigId(event.target.value)}
                    className="block w-full rounded-lg border border-border bg-surface-50 px-3 py-2.5 text-sm dark:bg-surface-800"
                  >
                    <option value="">{translateRecentFeature("studyPlans.ui.use-app-default.0dcf2935")}</option>
                    {selectedConfigId && !usableProviders.some((config) => config.id === selectedConfigId) && (
                      <option value={selectedConfigId} disabled>{translateRecentFeature("studyPlans.ui.previously-selected-model-is.d78ad167")}</option>
                    )}
                    {usableProviders.map((config) => (
                      <option key={config.id} value={config.id}>
                        {PROVIDER_CONFIGS[config.provider].name} · {config.name} · {config.model}
                      </option>
                    ))}
                  </select>
                </label>
                {isPreflighting && <p role="status" className="text-sm text-muted-foreground">{translateRecentFeature("studyPlans.ui.checking-model-sources-and-p.0a469cf9")}</p>}
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
            <p className="text-sm text-muted-foreground">{translateRecentFeature("studyPlans.ui.you-can-close-this-window-an.2e3ebe00")}</p>

            {/* Footer Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
              <Button variant="text" onClick={closeWhenIdle}>
                {translateRecentFeature("common.cancel")}</Button>
              <Button
                variant="filled"
                onClick={handleStartGeneration}
                disabled={!canGenerate}
              >
                <Play size={16} />
                <span>
                  {mode === 'ai' ? recoveryJob ? translateRecentFeature("studyPlans.ui.resume-ai-generation.b7efe351") : translateRecentFeature("studyPlans.ui.start-ai-generation.e21b794c") : translateRecentFeature("studyPlans.ui.build-deterministic-outline.8343639b")}
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
                    {translateRecentFeature("studyPlans.ui.open-saved-draft.a412c3cb")}</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Preview & Acceptance */}
        {step === 'preview' && retrieval && (
          <details className="rounded-xl border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{translateRecentFeature("studyPlans.ui.generation-details.df0b997d")}</summary>
            <p className="mt-2">
              {retrieval.mode === 'semantic' ? translateRecentFeature("studyPlans.ui.semantic-retrieval.7ca5e452")
                : retrieval.mode === 'lexicalOnly' ? translateRecentFeature("studyPlans.ui.lexical-retrieval.33039ada")
                : retrieval.mode === 'mixed' ? translateRecentFeature("studyPlans.ui.semantic-and-lexical-retriev.626cca8d") : translateRecentFeature("studyPlans.ui.retrieval-unavailable.7e415860")}
              {retrieval.embeddingModels.length ? ` · ${retrieval.embeddingModels.join(', ')}` : ''}
            </p>
            <p>{translateRecentFeature("studyPlans.ui.var0-verified-passages-from-.18057b34", {var0: retrieval.verifiedPassages, var1: retrieval.documentsWithEvidence, var2: currentPlanDetail.version.sourceScope?.resolvedDocuments.length ?? 0})}</p>
            <p>{translateRecentFeature("studyPlans.ui.var0-retrieval-queries-var1-.de92f0ab", {var0: retrieval.queryCount, var1: retrieval.failedQueries})}</p>
            {execution && (
              <div className="mt-2">
                <p>{translateRecentFeature("studyPlans.ui.var0-model-calls-including-v.24a12db2", {var0: execution.modelCalls, var1: execution.corrections, var2: Math.round(execution.durationMs / 1000)})}</p>
                {execution.responsesWithUsage > 0 && (
                  <p>{translateRecentFeature("studyPlans.ui.var0-input-and-var1-output-t.baf24b5b", {var0: execution.reportedInputTokens.toLocaleString(), var1: execution.reportedOutputTokens.toLocaleString(), var2: execution.responsesWithUsage, var3: execution.modelCalls})}</p>
                )}
              </div>
            )}
            <p className="text-muted-foreground">{translateRecentFeature("studyPlans.ui.retrieval-searches-for-relev.339d7f46")}</p>
          </details>
        )}
        {step === 'preview' && (
          <>
            {jobProgress?.labelKey === 'study_generation.progress.prerequisites_unavailable' && (
              <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                {translateRecentFeature("studyPlans.ui.the-draft-is-ready-to-review.46692658")}</p>
            )}
            {diagnosticSlot}
            <CurriculumDraftPreview
              planDetail={currentPlanDetail}
              mergeResult={mergeResult}
              isRulesOnly={mode === 'rules-only'}
              onOpenSource={onOpenSource}
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
