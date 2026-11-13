import React, { useState } from 'react';
import type {
  KnowledgeGapView,
  RemediationRecommendation,
} from '../../../types/learningEvidence';
import { RemediationAction } from './RemediationAction';
import { RemediationDisposition } from './RemediationDisposition';
import {
  contextFromGap,
  createFollowUpExamDraft,
  createPlanAdjustmentDraft,
  createTargetedPracticeDraft,
  type RemediationClients,
} from '../../../lib/study-plans/remediation/remediationService';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface RemediationListProps {
  gap: KnowledgeGapView;
  recommendations: RemediationRecommendation[];
  clients?: Pick<RemediationClients, 'createBlueprintDraft' | 'savePlanDraft' | 'recordDisposition' | 'openSource'>;
  planRevision?: number;
  onDraftCreated?: (revisionId: string, kind: string) => void;
}

export const RemediationList: React.FC<RemediationListProps> = ({
  gap,
  recommendations,
  clients,
  planRevision = 0,
  onDraftCreated,
}) => {
  useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState(recommendations);

  const handleAction = async (rec: RemediationRecommendation) => {
        if (!clients) {
      setNotice(translateRecentFeature("studyPlans.ui.draft-creation-unavailable-h.911fd374"));
      return;
    }
    const ctx = contextFromGap(gap);
    try {
      if (rec.kind === 'open-source') {
        const first = rec.sourceRefIds[0];
        if (!first) {
          setNotice(translateRecentFeature("studyPlans.ui.source-unavailable-historica.b1ba9c19"));
          return;
        }
        await clients.openSource(first);
        setNotice(translateRecentFeature("studyPlans.ui.source-opened-in-current-rev.c26adbb2"));
        return;
      }
      if (rec.kind === 'targeted-practice') {
        if (!ctx.sourceScope) {
          setNotice(translateRecentFeature("studyPlans.ui.practice-draft-needs-a-froze.dcbdcd39"));
          return;
        }
        const out = await createTargetedPracticeDraft(ctx, clients);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        onDraftCreated?.(out.revisionId, rec.kind);
        setNotice(translateRecentFeature("studyPlans.ui.practice-draft-created-var0-.86fbbba8", {var0: out.revisionId}));
        return;
      }
      if (rec.kind === 'follow-up-exam') {
        if (!ctx.sourceScope) {
          setNotice(translateRecentFeature("studyPlans.ui.follow-up-draft-needs-a-froz.c9000206"));
          return;
        }
        const out = await createFollowUpExamDraft(ctx, clients);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        onDraftCreated?.(out.revisionId, rec.kind);
        setNotice(translateRecentFeature("studyPlans.ui.follow-up-draft-created-var0.5ed5c435", {var0: out.revisionId}));
        return;
      }
      if (rec.kind === 'plan-adjustment') {
        await createPlanAdjustmentDraft(ctx, clients, planRevision);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        setNotice(translateRecentFeature("studyPlans.ui.plan-adjustment-draft-reques.1e2f5de5"));
        return;
      }
      setNotice(translateRecentFeature("studyPlans.ui.tutor-hints-and-cards-land-i.eb981e1d", {var0: rec.kind}));
    } catch (err) {
      setNotice(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  const handleDisposition = (rec: RemediationRecommendation) => async (status: 'accepted' | 'dismissed' | 'completed') => {
        if (!clients) {
      setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status } : r)));
      setNotice(translateRecentFeature("studyPlans.ui.disposition-recorded-locally.1ebd7075"));
      return;
    }
    const updated = await clients.recordDisposition(rec.id, status);
    setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: updated.status } : r)));
    setNotice(translateRecentFeature("studyPlans.ui.disposition-var0-persisted-e.d550167f", {var0: status, var1: status === 'dismissed' ? ' and reversible' : ''}));
  };

  return (
    <div data-testid={`remediation-list-${gap.id}`} className="space-y-2">
      {items.map((rec) => (
        <div key={rec.id} className="rounded-xl border border-outline-variant/30 p-3 space-y-2">
          <RemediationAction
            recommendation={rec}
            onAction={rec.kind === 'tutor' || rec.kind === 'card-proposals' ? undefined : (r) => handleAction(r)}
            disabledReason={
              rec.kind === 'tutor' || rec.kind === 'card-proposals'
                ? 'Available in Change 7 — not completed here'
                : null
            }
          />
          <RemediationDisposition
            recommendationId={rec.id}
            status={rec.status}
            onDisposition={handleDisposition(rec)}
          />
        </div>
      ))}
      {notice && (
        <p role="status" data-testid="remediation-notice" className="text-xs">
          {notice}
        </p>
      )}
    </div>
  );
};
