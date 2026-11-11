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
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState(recommendations);

  const handleAction = async (rec: RemediationRecommendation) => {
    if (!clients) {
      setNotice('Draft creation unavailable here — no native client.');
      return;
    }
    const ctx = contextFromGap(gap);
    try {
      if (rec.kind === 'open-source') {
        const first = rec.sourceRefIds[0];
        if (!first) {
          setNotice('Source unavailable — historical excerpt preserved.');
          return;
        }
        await clients.openSource(first);
        setNotice('Source opened in current revision context.');
        return;
      }
      if (rec.kind === 'targeted-practice') {
        if (!ctx.sourceScope) {
          setNotice('Practice draft needs a frozen source scope — open the plan progress tab.');
          return;
        }
        const out = await createTargetedPracticeDraft(ctx, clients);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        onDraftCreated?.(out.revisionId, rec.kind);
        setNotice(`Practice draft created (${out.revisionId}). No attempt auto-started.`);
        return;
      }
      if (rec.kind === 'follow-up-exam') {
        if (!ctx.sourceScope) {
          setNotice('Follow-up draft needs a frozen source scope — open the plan progress tab.');
          return;
        }
        const out = await createFollowUpExamDraft(ctx, clients);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        onDraftCreated?.(out.revisionId, rec.kind);
        setNotice(`Follow-up draft created (${out.revisionId}). Review and publish explicitly.`);
        return;
      }
      if (rec.kind === 'plan-adjustment') {
        await createPlanAdjustmentDraft(ctx, clients, planRevision);
        await clients.recordDisposition(rec.id, 'accepted');
        setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: 'accepted' as const } : r)));
        setNotice('Plan-adjustment draft requested. Review the diff before publishing.');
        return;
      }
      setNotice(`Tutor, hints and cards land in Change 7 — “${rec.kind}” is not completed here.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisposition = (rec: RemediationRecommendation) => async (status: 'accepted' | 'dismissed' | 'completed') => {
    if (!clients) {
      setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status } : r)));
      setNotice('Disposition recorded locally — native unavailable.');
      return;
    }
    const updated = await clients.recordDisposition(rec.id, status);
    setItems((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status: updated.status } : r)));
    setNotice(`Disposition ${status} persisted; evidence preserved${status === 'dismissed' ? ' and reversible' : ''}.`);
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
