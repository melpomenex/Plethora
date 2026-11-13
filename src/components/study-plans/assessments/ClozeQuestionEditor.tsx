/**
 * Cloze (Fill-in-the-blank) Question Editor Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.3
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React from 'react';
import { Plus, Trash, TextT } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { ClozeQuestion, ClozeSegment, ClozeBlank } from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface ClozeQuestionEditorProps {
  question: ClozeQuestion;
  onChange: (updated: ClozeQuestion) => void;
  disabled?: boolean;
  className?: string;
}

export const ClozeQuestionEditor: React.FC<ClozeQuestionEditorProps> = ({
  question,
  onChange,
  disabled = false,
  className = '',
}) => {
        useI18n();
        const handleAddTextSegment = () => {
        const newSeg: ClozeSegment = { kind: 'text', text: translateRecentFeature("studyPlans.ui.additional-text.6a068830") };
    onChange({
      ...question,
      segments: [...question.segments, newSeg],
    });
  };

  const handleAddBlank = () => {
    const blankId = `b_${Date.now()}`;
    const newSeg: ClozeSegment = { kind: 'blank', blankId };
    const newBlank: ClozeBlank = {
      id: blankId,
      acceptedAnswers: ['answer'],
      caseSensitive: false,
    };

    onChange({
      ...question,
      segments: [...question.segments, newSeg],
      blanks: [...question.blanks, newBlank],
    });
  };

  const handleRemoveSegment = (index: number) => {
    const seg = question.segments[index];
    const nextSegments = question.segments.filter((_, i) => i !== index);
    let nextBlanks = question.blanks;

    if (seg.kind === 'blank') {
      nextBlanks = question.blanks.filter((b) => b.id !== seg.blankId);
    }

    onChange({
      ...question,
      segments: nextSegments,
      blanks: nextBlanks,
    });
  };

  const handleTextSegmentChange = (index: number, text: string) => {
    const nextSegments = [...question.segments];
    nextSegments[index] = { kind: 'text', text };
    onChange({ ...question, segments: nextSegments });
  };

  const handleBlankAnswersChange = (blankId: string, answersStr: string) => {
    const acceptedAnswers = answersStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const nextBlanks = question.blanks.map((b) =>
      b.id === blankId ? { ...b, acceptedAnswers } : b
    );
    onChange({ ...question, blanks: nextBlanks });
  };

  const handleBlankCaseToggle = (blankId: string, caseSensitive: boolean) => {
    const nextBlanks = question.blanks.map((b) =>
      b.id === blankId ? { ...b, caseSensitive } : b
    );
    onChange({ ...question, blanks: nextBlanks });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400 block">
          {translateRecentFeature("studyPlans.ui.cloze-text-segments-fill-in-.ba81a1cd")}</label>
        {!disabled && (
          <div className="flex items-center gap-2">
            <Button variant="outlined" size="sm" onClick={handleAddTextSegment} className="text-xs">
              <TextT className="w-3.5 h-3.5 mr-1" />
              {translateRecentFeature("studyPlans.ui.add-text.5ce8cd90")}</Button>
            <Button variant="outlined" size="sm" onClick={handleAddBlank} className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" />
              {translateRecentFeature("studyPlans.ui.add-blank.80f988b2")}</Button>
          </div>
        )}
      </div>

      {/* Segments editor */}
      <div className="p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-2">
        <span className="text-[11px] font-semibold text-surface-500 block">{translateRecentFeature("studyPlans.ui.segments-flow.d7e8efe8")}</span>
        <div className="space-y-2">
          {question.segments.map((seg, sIdx) => {
                        if (seg.kind === 'text') {
              return (
                <div key={`seg-text-${sIdx}`} className="flex items-center gap-2">
                  <span className="text-[10px] text-surface-400 w-12 font-mono">{translateRecentFeature("studyPlans.ui.text.2d45dbb6")}</span>
                  <input
                    type="text"
                    value={seg.text}
                    disabled={disabled}
                    onChange={(e) => handleTextSegmentChange(sIdx, e.target.value)}
                    className="flex-1 h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                    aria-label={translateRecentFeature("studyPlans.ui.text-segment-var0.a19a0784", {var0: sIdx})}
                  />
                  {!disabled && question.segments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSegment(sIdx)}
                      className="p-1 text-surface-400 hover:text-red-600"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            }

            const blank = question.blanks.find((b) => b.id === seg.blankId);

            return (
              <div
                key={`seg-blank-${seg.blankId}`}
                className="p-2.5 rounded-lg border border-primary-300 dark:border-primary-800 bg-primary-50/40 dark:bg-primary-950/20 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary-700 dark:text-primary-300 font-mono">{translateRecentFeature("studyPlans.ui.blank-var0.362b301b", {var0: seg.blankId})}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={blank?.caseSensitive ?? false}
                        disabled={disabled}
                        onChange={(e) => handleBlankCaseToggle(seg.blankId, e.target.checked)}
                        className="rounded border-surface-300"
                      />
                      <span>{translateRecentFeature("studyPlans.ui.case-sensitive.7d749560")}</span>
                    </label>

                    {!disabled && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSegment(sIdx)}
                        className="p-1 text-surface-400 hover:text-red-600"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-surface-600 dark:text-surface-400 block">
                    {translateRecentFeature("studyPlans.ui.accepted-answers-comma-separ.4c770263")}</span>
                  <input
                    type="text"
                    value={blank?.acceptedAnswers.join(', ') ?? ''}
                    disabled={disabled}
                    onChange={(e) => handleBlankAnswersChange(seg.blankId, e.target.value)}
                    placeholder={translateRecentFeature("studyPlans.ui.e-g-raft-raft-consensus.fcd6c090")}
                    className="w-full h-7 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
                    aria-label={translateRecentFeature("studyPlans.ui.blank-var0-accepted-answers.58477b42", {var0: seg.blankId})}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
