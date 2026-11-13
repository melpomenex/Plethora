import React, { useState } from 'react';
import type { KnowledgeGapView } from '../../../types/learningEvidence';
import type { TargetedPracticeOptions } from '../../../lib/study-plans/remediation/remediationService';
import { GapEvidencePanel } from './GapEvidencePanel';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface KnowledgeGapCardProps {
  gap: KnowledgeGapView;
  onDismiss?: (gapId: string) => void;
  onOpenSource?: (sourceRefId: string | null) => void;
  onPrepareAssessment?: (gap: KnowledgeGapView, mode: 'practice' | 'exam', options?: TargetedPracticeOptions) => void;
  onOpenLesson?: (nodeId: string) => void;
  onProposeCards?: (gap: KnowledgeGapView) => void;
}

function structuralNote(kind: KnowledgeGapView['kind']): string | null {
  if (kind === 'missing_concept') return 'Structural material gap — not a learner deficit claim.';
  if (kind === 'disconnected_cluster') return 'Structural graph gap — material organization issue, not a learner deficit.';
  if (kind === 'read_never_reviewed') return 'Reading-only signal — no assessment claim.';
  return null;
}

export const KnowledgeGapCard: React.FC<KnowledgeGapCardProps> = ({ gap, onDismiss, onOpenSource, onPrepareAssessment, onOpenLesson, onProposeCards }) => {
        useI18n();
        const note = structuralNote(gap.kind);
  const [emphasis, setEmphasis] = useState<'recall' | 'application' | 'transfer'>('recall');
  const [paper, setPaper] = useState<'fresh' | 'same'>('fresh');
  return (
    <article
      aria-label={translateRecentFeature("studyPlans.ui.knowledge-gap-var0.548db1bf", {var0: gap.conceptName})}
      data-testid={`gap-card-${gap.id}`}
      data-gap-kind={gap.kind}
      data-gap-status={gap.status}
      className="rounded-xl border border-outline-variant/30 p-4 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm" data-testid="gap-title">
          {gap.conceptName} — {gap.kind}
        </h4>
        <span data-testid="gap-status" className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high">
          {gap.status}
        </span>
      </div>
      <p className="text-xs text-on-surface-variant" data-testid="gap-rule">{translateRecentFeature("studyPlans.ui.rule-var0-evidence-cutoff-va.fe7b421d", {var0: gap.ruleId, var1: gap.evidenceCutoff})}</p>
      {note && (
        <p className="text-xs" data-testid="gap-structural-note">
          {note}
        </p>
      )}
      {gap.demonstrated && (
        <p className="text-xs" data-testid="gap-demonstrated">
          {translateRecentFeature("studyPlans.ui.observed.00bc66ab")}{gap.demonstrated.observedMean !== null ? `${(gap.demonstrated.observedMean * 100).toFixed(2)}%` : '—'}
          {' '}{translateRecentFeature("studyPlans.ui.var0-sessions-not-a-mastery-.3210c1f4", {var0: gap.demonstrated.independentSessions})}</p>
      )}
      <GapEvidencePanel gap={gap} onOpenSource={onOpenSource} />
      {gap.status === 'active' && gap.demonstrated && (onPrepareAssessment || onProposeCards) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-on-surface-variant">
              {translateRecentFeature("studyPlans.ui.emphasis.1c0017f2")}<select
                value={emphasis}
                onChange={(e) => setEmphasis(e.target.value as 'recall' | 'application' | 'transfer')}
                aria-label={translateRecentFeature("studyPlans.ui.practice-emphasis.0f06e015")}
                className="ml-1 h-7 px-1 text-xs rounded border border-outline-variant bg-transparent"
              >
                <option value="recall">{translateRecentFeature("studyPlans.ui.recall.38d6b670")}</option>
                <option value="application">{translateRecentFeature("studyPlans.ui.application.d7e48663")}</option>
                <option value="transfer">{translateRecentFeature("studyPlans.ui.transfer.1f7de008")}</option>
              </select>
            </label>
            <label className="text-xs text-on-surface-variant">
              {translateRecentFeature("studyPlans.ui.paper.5c85bacb")}<select
                value={paper}
                onChange={(e) => setPaper(e.target.value as 'fresh' | 'same')}
                aria-label={translateRecentFeature("studyPlans.ui.paper-selection.e56452be")}
                className="ml-1 h-7 px-1 text-xs rounded border border-outline-variant bg-transparent"
              >
                <option value="fresh">{translateRecentFeature("studyPlans.ui.fresh.e5d5431c")}</option>
                <option value="same">{translateRecentFeature("studyPlans.ui.same-paper.a983fac9")}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            {gap.nodeId && onOpenLesson && (
              <button type="button" className="min-h-10 text-sm underline"
                onClick={() => onOpenLesson(gap.nodeId!)}>{translateRecentFeature("studyPlans.ui.open-targeted-lesson.352b9cf0")}</button>
            )}
            {onPrepareAssessment && (
              <button type="button" className="min-h-10 text-sm underline"
                onClick={() => onPrepareAssessment(gap, 'practice', { emphasis, paper })}>{translateRecentFeature("studyPlans.ui.create-practice-draft.16d92bdc")}</button>
            )}
            {onPrepareAssessment && (
              <button type="button" className="min-h-10 text-sm underline"
                onClick={() => onPrepareAssessment(gap, 'exam')}>{translateRecentFeature("studyPlans.ui.create-follow-up-exam-draft.41a04293")}</button>
            )}
            {onProposeCards && (
              <button type="button" className="min-h-10 text-sm underline"
                onClick={() => onProposeCards(gap)}>{translateRecentFeature("studyPlans.ui.make-cards.c25e7140")}</button>
            )}
          </div>
        </div>
      )}
      {gap.status === 'active' && onDismiss && (
        <button
          type="button"
          data-testid={`gap-dismiss-${gap.id}`}
          onClick={() => onDismiss(gap.id)}
          className="text-xs underline"
          aria-label={translateRecentFeature("studyPlans.ui.dismiss-gap-var0.34942723", {var0: gap.conceptName})}
        >
          {translateRecentFeature("studyPlans.ui.dismiss-evidence-preserved.48a42b62")}</button>
      )}
    </article>
  );
};
