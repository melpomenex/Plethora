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

export const StudyPlanCreateForm: React.FC<StudyPlanCreateFormProps> = ({
  onSuccess,
  onCancel,
  initialPrefill,
  diagnosticSlot,
}) => {
  const createPlanAction = useLearningPathsStore((s) => s.createStudyPlan);

  const [title, setTitle] = useState(initialPrefill?.title || '');
  const [goal, setGoal] = useState(initialPrefill?.goal || initialPrefill?.conceptLabel || '');
  const [depth, setDepth] = useState<StudyDepth>('foundational');
  const [creationMethod, setCreationMethod] = useState<CreationMethod>('manual');
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
  const needsSources = creationMethod !== 'manual';
  const hasSelectedSources = sourceScope.documentIds.length + sourceScope.extractIds.length + sourceScope.collectionIds.length + sourceScope.tagIds.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const normalizedGoal = normalizeSessionGoal(goal);
    if (!normalizedGoal) return;

    setIsSubmitting(true);
    setError(null);

    try {
      if (needsSources && !hasSelectedSources) {
        setError('Select at least one source document to continue.');
        return;
      }
      const resolvedSourceScope = await resolveStudySourceScope(sourceScope);
      const input: CreateStudyPlanInput = {
        title: trimmedTitle,
        goal: normalizedGoal,
        depth,
        sourceScope: resolvedSourceScope,
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
      setError(studyErrorMessage(err, 'Failed to create study plan'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        aria-label="Create study plan form"
        className="w-full max-w-2xl mx-auto p-4 sm:p-6 space-y-6"
      >
        <div className="flex items-center gap-3 pb-4 border-b border-surface-200 dark:border-surface-700">
          <Button
            type="button"
            variant="text"
            size="iconSm"
            onClick={onCancel}
            aria-label="Back to study plans"
          >
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100">
              Create Study Plan
            </h2>
            <p className="text-xs text-surface-500">
              Design a custom learning path grounded in your library material.
            </p>
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
              Plan Title <span className="text-red-500">*</span>
            </label>
            <span className="text-[11px] text-surface-400">{title.length} / 120</span>
          </div>
          <input
            id="plan-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Modern Cryptography & Zero Knowledge Proofs"
            maxLength={120}
            required
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Goal */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="plan-goal" className="text-xs font-bold text-surface-800 dark:text-surface-200">
              Learning Objective <span className="text-red-500">*</span>
            </label>
            <span className="text-[11px] text-surface-400">{goal.length} / 200</span>
          </div>
          <textarea
            id="plan-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What do you want to learn or achieve with this plan?"
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
            Curriculum Depth
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'survey',
                  label: 'Survey',
                  desc: 'Broad high-level overview of key topics.',
                },
                {
                  id: 'foundational',
                  label: 'Foundational',
                  desc: 'Core principles, prerequisite concepts, and relationships.',
                },
                {
                  id: 'deep',
                  label: 'Deep',
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
            Curriculum Creation Method
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'manual' as const,
                label: 'Manual Authoring',
                desc: 'Add topics and prerequisite dependencies manually.',
                icon: PencilSimple,
              },
              {
                id: 'ai' as const,
                label: 'Generate with AI',
                desc: 'Decompose source material into structured topics using AI.',
                icon: Sparkle,
              },
              {
                id: 'rules-only' as const,
                label: 'Source Outline (No AI)',
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
        <SourceScopePicker selectedScope={sourceScope} onChange={setSourceScope} maxDocuments={24} />

        {diagnosticSlot}

        {/* Form Buttons */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-surface-200 dark:border-surface-700">
          <Button type="button" variant="text" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="filled"
            disabled={!canSubmit}
          >
            {isSubmitting && <SpinnerGap size={16} className="animate-spin" />}
            <span>
              {isSubmitting
                ? 'Creating Draft…'
                : creationMethod === 'manual'
                  ? 'Create Draft Plan'
                  : creationMethod === 'ai'
                    ? 'Continue to AI Generation'
                    : 'Continue to Source Outline'}
            </span>
          </Button>
        </div>
      </form>

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
