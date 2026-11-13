/**
 * Study Plan Creation Form component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React, { useState } from 'react';
import {
  ArrowLeft,
  Warning,
  SpinnerGap,
  Sparkle,
  ShieldCheck,
  PencilSimple,
} from '@phosphor-icons/react';
import { validateSessionGoal, normalizeSessionGoal } from '../../lib/daqe/sessionGoal';
import { useLearningPathsStore } from '../../stores/learningPathsStore';
import type { CreateStudyPlanInput, StudyDepth, StudyPlanDetail } from '../../types/learningPaths';
import type { SelectedSourceScope } from '../../types/studySource';
import { resolveStudySourceScope } from '../../api/study-sources';
import { studyErrorMessage } from '../../lib/study-plans/studyErrorMessage';
import { SourceScopePicker } from './SourceScopePicker';
import { CurriculumGenerator } from './CurriculumGenerator';
import { Button } from '../md3/Button';
import { StudyPlansScrollContainer } from './StudyPlansScrollContainer';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface StudyPlanCreateFormProps {
  onSuccess: (detail: StudyPlanDetail) => void;
  onCancel: () => void;
  initialPrefill?: {
    title?: string;
    goal?: string;
    documentIds?: string[];
    extractIds?: string[];
    collectionIds?: string[];
    tagIds?: string[];
    conceptLabel?: string;
  };
  /** C7-T03 optional diagnostic host slot (Take/Skip UI injected by caller). */
  diagnosticSlot?: React.ReactNode;
}

export type CreationMethod = 'manual' | 'ai' | 'rules-only';
type KnowledgePolicyChoice = 'source-only' | 'source-plus-model-knowledge' | 'model-only';

export const StudyPlanCreateForm: React.FC<StudyPlanCreateFormProps> = ({
  onSuccess,
  onCancel,
  initialPrefill,
  diagnosticSlot,
}) => {
    useI18n();
    const createPlanAction = useLearningPathsStore((s) => s.createStudyPlan);

  const [title, setTitle] = useState(initialPrefill?.title || '');
  const [goal, setGoal] = useState(initialPrefill?.goal || initialPrefill?.conceptLabel || '');
  const [depth, setDepth] = useState<StudyDepth>('foundational');
  const [creationMethod, setCreationMethod] = useState<CreationMethod>('manual');
  const [knowledgePolicy, setKnowledgePolicy] = useState<KnowledgePolicyChoice>(() => {
    const hasPrefill = !!(initialPrefill?.documentIds?.length || initialPrefill?.extractIds?.length ||
      initialPrefill?.collectionIds?.length || initialPrefill?.tagIds?.length);
    return hasPrefill ? 'source-plus-model-knowledge' : 'model-only';
  });
  const [sourceScope, setSourceScope] = useState<SelectedSourceScope>({
    documentIds: initialPrefill?.documentIds || [],
    extractIds: initialPrefill?.extractIds ?? [],
    collectionIds: initialPrefill?.collectionIds ?? [],
    tagIds: initialPrefill?.tagIds ?? [],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Curriculum Generator modal state
  const [generatorPlanDetail, setGeneratorPlanDetail] = useState<StudyPlanDetail | null>(null);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);

  const trimmedTitle = title.trim();
  const isTitleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= 120;
  const goalValidation = validateSessionGoal(goal);

  const canSubmit = isTitleValid && goalValidation.ok && !isSubmitting;
  const hasSelectedSources = sourceScope.documentIds.length + sourceScope.extractIds.length + sourceScope.collectionIds.length + sourceScope.tagIds.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
    if (!canSubmit) return;

    const normalizedGoal = normalizeSessionGoal(goal);
    if (!normalizedGoal) return;

    setIsSubmitting(true);
    setError(null);

    try {
      if (knowledgePolicy !== 'model-only' && !hasSelectedSources) {
        setError(translateRecentFeature("studyPlans.ui.select-material-or-explicitl.320b7814"));
        return;
      }
      if (creationMethod === 'rules-only' && knowledgePolicy === 'model-only') {
        setError(translateRecentFeature("studyPlans.ui.source-outline-requires-sele.d9ebfaf5"));
        return;
      }
      const resolvedSourceScope = knowledgePolicy === 'model-only'
        ? null
        : await resolveStudySourceScope(sourceScope);
      const input: CreateStudyPlanInput = {
        title: trimmedTitle,
        goal: normalizedGoal,
        depth,
        sourceScope: resolvedSourceScope,
        knowledgeAuthority: knowledgePolicy === 'model-only'
          ? { kind: 'model-only' }
          : { kind: 'library', policy: knowledgePolicy },
      };
      const detail = await createPlanAction(input);

      if (creationMethod === 'manual') {
        onSuccess(detail);
      } else {
        // Open Curriculum Generator modal
        setGeneratorPlanDetail(detail);
        setIsGeneratorOpen(true);
      }
    } catch (err: unknown) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.failed-to-create-study-plan.a6be77f3")));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <StudyPlansScrollContainer data-study-plans-scroll="create">
      <form
        onSubmit={handleSubmit}
        aria-label={translateRecentFeature("studyPlans.ui.create-study-plan-form.bda84ac8")}
        className="w-full max-w-2xl mx-auto p-4 sm:p-6 space-y-6"
      >
        <div className="flex items-center gap-3 pb-4 border-b border-surface-200 dark:border-surface-700">
          <Button
            type="button"
            variant="text"
            size="iconSm"
            onClick={onCancel}
            aria-label={translateRecentFeature("studyPlans.ui.back-to-study-plans.e604d5b3")}
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">
              {translateRecentFeature("studyPlans.ui.create-study-plan.e0316395")}</h2>
            <p className="text-xs text-surface-500">
              {translateRecentFeature("studyPlans.ui.design-a-custom-learning-pat.eb35b9e1")}</p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
          >
            <Warning size={16} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Title */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="plan-title" className="text-xs font-bold text-surface-800 dark:text-surface-200">
              {translateRecentFeature("studyPlans.ui.plan-title.f7526ee7")}<span className="text-red-500">*</span>
            </label>
            <span className="text-[11px] text-surface-400">{translateRecentFeature("studyPlans.ui.var0-120.a4009e9e", {var0: title.length})}</span>
          </div>
          <input
            id="plan-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={translateRecentFeature("studyPlans.ui.e-g-modern-cryptography-zero.6db93302")}
            maxLength={120}
            required
            className="w-full min-h-11 px-3.5 py-2 text-base sm:text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Goal */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="plan-goal" className="text-xs font-bold text-surface-800 dark:text-surface-200">
              {translateRecentFeature("studyPlans.ui.learning-objective.cd47e870")}<span className="text-red-500">*</span>
            </label>
            <span className="text-[11px] text-surface-400">{translateRecentFeature("studyPlans.ui.var0-200.6b88f52c", {var0: goal.length})}</span>
          </div>
          <textarea
            id="plan-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={translateRecentFeature("studyPlans.ui.what-do-you-want-to-learn-or.d9b6f9e8")}
            rows={3}
            maxLength={200}
            required
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
          {goal.length > 0 && !goalValidation.ok && (
            <p className="text-[11px] text-red-500">{goalValidation.error}</p>
          )}
        </div>

        {/* Depth selector */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-surface-800 dark:text-surface-200 mb-2">
            {translateRecentFeature("studyPlans.ui.knowledge-source-policy.3ff36d4f")}</legend>
          <p className="text-[11px] text-surface-500 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.this-controls-what-ai-may-us.d65203e6")}</p>
          <div className="grid grid-cols-1 gap-2">
            {([
              {
                id: 'source-only' as const,
                label: translateRecentFeature("studyPlans.ui.my-library-only.18220acf"),
                desc: 'Use selected material for course facts. The AI says when it cannot find support.',
              },
              {
                id: 'source-plus-model-knowledge' as const,
                label: translateRecentFeature("studyPlans.ui.my-library-ai-knowledge.013ece5e"),
                desc: 'Prioritize selected material and label explanations that are not verified by it.',
              },
              {
                id: 'model-only' as const,
                label: translateRecentFeature("studyPlans.ui.ai-knowledge-only.c613843f"),
                desc: 'Build without reading your library. Generated curriculum is unverified.',
              },
            ]).map((choice) => (
              <label
                key={choice.id}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs ${
                  knowledgePolicy === choice.id
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-200 dark:border-surface-700'
                }`}
              >
                <input
                  type="radio"
                  name="knowledge-policy"
                  value={choice.id}
                  checked={knowledgePolicy === choice.id}
                  onChange={() => setKnowledgePolicy(choice.id)}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                />
                <span>
                  <span className="block font-bold">{choice.label}</span>
                  <span className="mt-0.5 block text-[11px] text-surface-500 dark:text-surface-400">{choice.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-surface-800 dark:text-surface-200 mb-2">
            {translateRecentFeature("studyPlans.ui.curriculum-depth.764fd5cf")}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'survey',
                  label: translateRecentFeature("studyPlans.ui.survey.12b368d7"),
                  desc: 'Broad high-level overview of key topics.',
                },
                {
                  id: 'foundational',
                  label: translateRecentFeature("studyPlans.ui.foundational.1443f7dc"),
                  desc: 'Core principles, prerequisite concepts, and relationships.',
                },
                {
                  id: 'deep',
                  label: translateRecentFeature("studyPlans.ui.deep.e8cc92be"),
                  desc: 'Comprehensive multi-stage study with detailed objectives.',
                },
              ] as const
            ).map((d) => (
              <label
                key={d.id}
                className={`flex flex-col p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                  depth === d.id
                    ? 'border-primary-500 bg-primary-500/10 text-primary-900 dark:text-primary-100'
                    : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <input
                    type="radio"
                    name="plan-depth"
                    value={d.id}
                    checked={depth === d.id}
                    onChange={() => setDepth(d.id)}
                    className="text-primary-600 focus:ring-primary-500"
                  />
                  <span className="font-bold">{d.label}</span>
                </div>
                <span className="text-[11px] text-surface-500 dark:text-surface-400 pl-5">
                  {d.desc}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Creation Method Selector */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold text-surface-800 dark:text-surface-200 mb-2">
            {translateRecentFeature("studyPlans.ui.curriculum-creation-method.8f5738a1")}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'manual' as const,
                label: translateRecentFeature("studyPlans.ui.manual-authoring.849fd611"),
                desc: 'Add topics and prerequisite dependencies manually.',
                icon: PencilSimple,
              },
              {
                id: 'ai' as const,
                label: translateRecentFeature("studyPlans.ui.generate-with-ai.65a96811"),
                desc: 'Decompose source material into structured topics using AI.',
                icon: Sparkle,
              },
              {
                id: 'rules-only' as const,
                label: translateRecentFeature("studyPlans.ui.source-outline-no-ai.2dd5747a"),
                desc: 'Build an outline from confirmed concepts and document titles.',
                icon: ShieldCheck,
              },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <label
                  key={m.id}
                  className={`flex flex-col p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                    creationMethod === m.id
                      ? 'border-primary-500 bg-primary-500/10 text-primary-900 dark:text-primary-100'
                      : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="radio"
                      name="creation-method"
                      value={m.id}
                      checked={creationMethod === m.id}
                      onChange={() => setCreationMethod(m.id)}
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <Icon size={14} className="text-primary-500" />
                    <span className="font-bold">{m.label}</span>
                  </div>
                  <span className="text-[11px] text-surface-500 dark:text-surface-400 pl-5">
                    {m.desc}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Material Scope */}
        {knowledgePolicy === 'model-only' ? (
          <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-3 text-xs text-surface-600 dark:text-surface-300">
            {translateRecentFeature("studyPlans.ui.no-material-will-be-read-fro.f46edaa4")}</div>
        ) : (
          <SourceScopePicker selectedScope={sourceScope} onChange={setSourceScope} maxDocuments={24} />
        )}

        {diagnosticSlot}

        {/* Form Buttons */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
          <Button type="button" variant="text" onClick={onCancel} disabled={isSubmitting} className="min-h-11 sm:w-auto">
            {translateRecentFeature("common.cancel")}</Button>
          <Button
            type="submit"
            variant="filled"
            disabled={!canSubmit}
            className="min-h-11 sm:w-auto"
          >
            {isSubmitting && <SpinnerGap size={16} className="animate-spin" />}
            <span>
              {isSubmitting
                ? translateRecentFeature("studyPlans.ui.creating-draft.3996abf8")
                : creationMethod === 'manual'
                  ? translateRecentFeature("studyPlans.ui.create-draft-plan.01020421")
                  : creationMethod === 'ai'
                    ? translateRecentFeature("studyPlans.ui.continue-to-ai-generation.3268c1ee")
                    : translateRecentFeature("studyPlans.ui.continue-to-source-outline.1a614473")}
            </span>
          </Button>
        </div>
      </form>
      </StudyPlansScrollContainer>

      {/* Curriculum Generator Modal */}
      {generatorPlanDetail && (
        <CurriculumGenerator
          planDetail={generatorPlanDetail}
          isOpen={isGeneratorOpen}
          initialMode={creationMethod === 'rules-only' ? 'rules-only' : 'ai'}
          onClose={() => {
            setIsGeneratorOpen(false);
            onSuccess(generatorPlanDetail);
          }}
          onSuccess={(published) => {
            setIsGeneratorOpen(false);
            onSuccess(published);
          }}
        />
      )}
    </>
  );
};
