/**
 * Full Examination Paper Preview & Publication Gate Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.4, §5.5
 * - openspec/changes/generate-study-plan-examinations/ (C3-T09)
 */

import React, { useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  CheckCircle,
  Pencil,
  Eye,
  EyeSlash,
  Warning,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type {
  BlueprintDetail,
  AssessmentQuestionRevision,
} from '../../../types/assessmentQuestions';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface AssessmentPreviewProps {
  blueprintDetail: BlueprintDetail;
  onPublish: (shortfallAccepted: boolean) => Promise<void>;
  onEditQuestion?: (questionRevision: AssessmentQuestionRevision) => void;
  onExcludeQuestion?: (slotKey: string) => Promise<void>;
  onStartAssessment?: (revisionId: string) => void;
  isPublishing?: boolean;
  className?: string;
}

export const AssessmentPreview: React.FC<AssessmentPreviewProps> = ({
  blueprintDetail,
  onPublish,
  onEditQuestion,
  onExcludeQuestion: _onExcludeQuestion,
  onStartAssessment,
  isPublishing = false,
  className = '',
}) => {
        useI18n();
        const { blueprint, revision, questions } = blueprintDetail;
  const isReady = revision.state === 'ready';
  const isExam = revision.config.mode === 'exam';

  const requestedCount = revision.config.requestedCount;
  const acceptedCount = questions.length;
  const hasShortfall = acceptedCount < requestedCount;

  const [shortfallAcknowledged, setShortfallAcknowledged] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPoints = questions.reduce(
    (sum, qr) => sum + (qr.question?.maxPoints ?? (qr as any).maxPoints ?? 1),
    0
  );

  const handlePublishClick = async () => {
    if (hasShortfall && !shortfallAcknowledged) {
      setErrorBanner(translateRecentFeature("studyPlans.ui.please-acknowledge-and-accep.e2000ce8"));
      return;
    }
    setErrorBanner(null);
    try {
      await onPublish(hasShortfall);
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Top Banner & Metadata */}
      <div className="p-5 rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold ${
                  isReady
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {revision.state}
              </span>
              <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {blueprint.title}
              </h2>
            </div>
            <p className="text-xs text-surface-500 mt-1">{translateRecentFeature("studyPlans.ui.revision-v-var0-published-at.56f899ed", {var0: blueprint.revision})}{' '}
              {revision.publishedAt ? new Date(revision.publishedAt).toLocaleString() : translateRecentFeature("studyPlans.ui.unpublished-draft.b2cba00b")}
            </p>
          </div>

          {/* Start Button (Public Projection gate: disabled until Ready) */}
          <div className="flex items-center gap-2">
            <Button
              variant="filled"
              size="sm"
              disabled={!isReady}
              onClick={() => onStartAssessment?.(revision.id)}
              className="bg-primary-600 hover:bg-primary-700 text-white"
            >
              {isExam ? (
                <GraduationCap className="w-4 h-4 mr-1.5" />
              ) : (
                <BookOpen className="w-4 h-4 mr-1.5" />
              )}
              {isExam ? translateRecentFeature("studyPlans.ui.start-examination.47dd8cec") : translateRecentFeature("studyPlans.ui.start-practice.be207895")}
            </Button>
          </div>
        </div>

        {/* Paper Statistics Grid */}
        <p data-testid="preview-hint-policy" className="text-xs text-surface-500">
          {translateRecentFeature("studyPlans.ui.committed-hints-are-authored.3e78fee8")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
            <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.paper-mode.d3dca8e5")}</span>
            <span className="font-semibold text-surface-800 dark:text-surface-200 capitalize">
              {revision.config.mode}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
            <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.questions.391023b3")}</span>
            <span className="font-semibold text-surface-800 dark:text-surface-200">{translateRecentFeature("studyPlans.ui.var0-of-var1-items.913e6dde", {var0: acceptedCount, var1: requestedCount})}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
            <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.total-score.6f4c0cce")}</span>
            <span className="font-semibold text-surface-800 dark:text-surface-200">{translateRecentFeature("studyPlans.ui.var0-points.09a2c5af", {var0: totalPoints})}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-surface-100 dark:bg-surface-700/50">
            <span className="text-surface-400 block text-[10px]">{translateRecentFeature("studyPlans.ui.timer.360df2e3")}</span>
            <span className="font-semibold text-surface-800 dark:text-surface-200">
              {revision.config.timeLimitSeconds
                ? translateRecentFeature("i18nAudit.ui.var0-minutes.f7937a35", {var0: Math.round(revision.config.timeLimitSeconds / 60)})
                : translateRecentFeature("studyPlans.ui.untimed.9e853fe7")}
            </span>
          </div>
        </div>
      </div>

      {errorBanner && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {errorBanner}
        </div>
      )}

      {/* Shortfall Acceptance Gate */}
      {!isReady && hasShortfall && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 space-y-3">
          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-100 font-semibold text-xs">
            <Warning className="w-4 h-4 text-amber-600" />
            <span>{translateRecentFeature("studyPlans.ui.shortfall-notice-var0-of-var.607e51ef", {var0: acceptedCount, var1: requestedCount})}</span>
          </div>
          <label className="flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={shortfallAcknowledged}
              onChange={(e) => setShortfallAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <span>{translateRecentFeature("studyPlans.ui.i-acknowledge-and-accept-the.87636096", {var0: requestedCount - acceptedCount})}</span>
          </label>
        </div>
      )}

      {/* Questions Itemized Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">{translateRecentFeature("studyPlans.ui.examination-paper-questions-.e235b1f7", {var0: questions.length})}</h3>

          {!isReady && (
            <Button
              variant="filled"
              size="sm"
              onClick={handlePublishClick}
              disabled={isPublishing || (hasShortfall && !shortfallAcknowledged)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" />
              {isPublishing ? translateRecentFeature("studyPlans.ui.publishing.3ef5cb82") : translateRecentFeature("studyPlans.ui.publish-examination-paper.4ce15e51")}
            </Button>
          )}
        </div>

        {questions.length === 0 ? (
          <div className="p-8 text-center text-xs text-surface-400 bg-surface-50 dark:bg-surface-800/20 rounded-xl border border-dashed border-surface-200 dark:border-surface-700">
            {translateRecentFeature("studyPlans.ui.no-questions-generated-or-ad.f6d43062")}</div>
        ) : (
          questions.map((qr, index) => {
                        const isExpanded = expandedKeys.has(qr.id);
            const q = qr.question || (typeof (qr as any).payload === 'object' ? (qr as any).payload : JSON.parse((qr as any).payload || '{}'));
            const kind = q.kind || (qr as any).kind;
            const diff = q.difficulty || (qr as any).difficulty;
            const points = q.maxPoints || (qr as any).maxPoints || 1;

            return (
              <div
                key={qr.id}
                className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/80 shadow-sm space-y-3"
              >
                {/* Question Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 font-bold text-xs flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300">
                      {kind}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">{translateRecentFeature("studyPlans.ui.diff-var0.1c1655a1", {var0: diff})}</span>
                    <span className="text-[10px] font-semibold text-primary-600 dark:text-primary-400">{translateRecentFeature(points === 1 ? "studyPlans.ui.var0-point.d1410fcd" : "studyPlans.ui.var0-points.0bcbc704", {var0: points})}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isReady && onEditQuestion && (
                      <button
                        type="button"
                        onClick={() => onEditQuestion(qr)}
                        className="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700"
                        title={translateRecentFeature("studyPlans.ui.edit-question.06052955")}
                        aria-label={translateRecentFeature("studyPlans.ui.edit-question.06052955")}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(qr.id)}
                      className="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700"
                      title={isExpanded ? translateRecentFeature("studyPlans.ui.hide-private-details.ea5e5686") : translateRecentFeature("studyPlans.ui.show-private-details.fd06024d")}
                      aria-label={isExpanded ? translateRecentFeature("studyPlans.ui.hide-answer-key.91b7cceb") : translateRecentFeature("studyPlans.ui.view-answer-key.55023633")}
                    >
                      {isExpanded ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Prompt */}
                <p className="text-xs font-medium text-surface-900 dark:text-surface-100 leading-relaxed">
                  {q?.prompt || translateRecentFeature("i18nAudit.ui.no-prompt-specified.8cd9190b")}
                </p>

                {/* Options / blanks preview */}
                {Array.isArray(q?.options) && (
                  <div className="space-y-1 pl-4 pt-1">
                    {q.options.map((opt: any, optIdx: number) => {
                                            const isCorrect =
                        q.correctOptionId === opt.id ||
                        q.correctOptionIds?.includes(opt.id);

                      return (
                        <div
                          key={opt.id}
                          className={`text-xs flex items-center gap-2 py-0.5 ${
                            isExpanded && isCorrect
                              ? 'font-bold text-emerald-600 dark:text-emerald-400'
                              : 'text-surface-600 dark:text-surface-300'
                          }`}
                        >
                          <span className="font-mono text-[11px] w-4">
                            {String.fromCharCode(65 + optIdx)}.
                          </span>
                          <span>{opt.text}</span>
                          {isExpanded && isCorrect && (
                            <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 font-normal">
                              {translateRecentFeature("studyPlans.ui.correct-key.ce144e67")}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Expandable Private Details (Keys, Rubrics, Hints, Sources, Provenance) */}
                {isExpanded && (
                  <div className="pt-3 border-t border-surface-200 dark:border-surface-700 space-y-2.5 text-xs bg-surface-50/50 dark:bg-surface-900/40 p-3 rounded-lg">
                    {q.kind === 'essay' && q.rubric && (
                      <div>
                        <span className="font-semibold text-surface-500 block text-[10px] uppercase">{translateRecentFeature("studyPlans.ui.committed-analytic-rubric-va.d6c144d0", {var0: q.rubric.criteria?.length || 0})}</span>
                        <div className="space-y-1 mt-1">
                          {q.rubric.criteria?.map((c: any) => (
                            <div key={c.id} className="text-[11px] p-2 rounded bg-surface-100 dark:bg-surface-800">
                              <span className="font-bold">{c.title || c.label}:</span>{' '}
                              <span>{c.assessmentInstruction || c.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {q?.explanation && (
                      <div>
                        <span className="font-semibold text-surface-500 block text-[10px] uppercase">
                          {translateRecentFeature("studyPlans.ui.pedagogical-explanation.f47d9cf4")}</span>
                        <p className="text-surface-700 dark:text-surface-300 italic text-[11px] mt-0.5">
                          {q.explanation}
                        </p>
                      </div>
                    )}

                    {q.sourceRefIds && q.sourceRefIds.length > 0 && (
                      <div className="flex items-center gap-2 text-[11px] text-surface-500">
                        <span className="font-semibold uppercase text-[10px]">{translateRecentFeature("studyPlans.ui.sources-cited.4ccaca24")}</span>
                        <span>{q.sourceRefIds.join(', ')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
