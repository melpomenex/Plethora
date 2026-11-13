/**
 * Study Plans Tab container and destination root.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §2.1, §2.2
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState } from 'react';
import { isTauri } from '../../lib/tauri';
import { StudyPlanStateNotice } from './StudyPlanStateNotice';
import { StudyPlanList } from './StudyPlanList';
import { StudyPlanCreateForm } from './StudyPlanCreateForm';
import { StudyPlanEditor } from './StudyPlanEditor';
import { AssessmentBuilder } from './assessments/AssessmentBuilder';
import { AttemptRunnerView } from './attempts/AttemptRunnerView';
import { AttemptResultsView } from './results/AttemptResultsView';
import { useLearningPathsStore } from '../../stores/learningPathsStore';
import { useDestinationAction, settleDestinationAction, requestDestinationAction } from '../../commandPalette/destinationActions';
import { PlanHomeTab } from './home/PlanHomeTab';
import type { StudyPlanDetail } from '../../types/learningPaths';
import type { StudySourceRefInput } from '../../types/studySource';
import { AttemptHistoryView } from './results/AttemptHistoryView';
import type { AssessmentConfigV1 } from '../../types/assessmentQuestions';
import { buildFollowUpExamConfig, buildTargetedPracticeConfig, contextFromGap } from '../../lib/study-plans/remediation/remediationService';
import { adaptRemediationToCardProposals } from '../../lib/study-plans/remediation/cardProposalAdapter';
import { LearnThisProposalSheet } from '../learn/LearnThisProposalSheet';
import { DiagnosticChoice } from './diagnostics/DiagnosticChoice';
import { buildPlanDiagnosticConfig } from '../../lib/study-plans/diagnostics/diagnosticConfig';
import type { KnowledgeGapView } from '../../types/learningEvidence';
import type { ReassessmentReturnContext } from './remediation/returnContext';

export type StudyPlansView =
  | { name: 'home' | 'assessment-history' }
  | {
      name: 'create';
      prefill?: {
        title?: string;
        goal?: string;
        documentIds?: string[];
        extractIds?: string[];
        collectionIds?: string[];
        tagIds?: string[];
        conceptId?: string;
        conceptLabel?: string;
        pendingSource?: StudySourceRefInput;
      };
    }
  | { name: 'plan'; planId: string; versionId?: string; nodeId?: string }
  | { name: 'plan-home'; planId: string }
  | { name: 'assessment-builder'; planId?: string; versionId?: string; blueprintRevisionId?: string; initialConfig?: AssessmentConfigV1; initialTitle?: string; returnContext?: ReassessmentReturnContext | null }
  | { name: 'attempt-runner'; attemptId: string; fromHistory?: boolean; planId?: string; returnContext?: ReassessmentReturnContext | null }
  | { name: 'attempt-results'; attemptId: string; fromHistory?: boolean; planId?: string; returnContext?: ReassessmentReturnContext | null };

export interface StudyPlansTabProps {
  initialView?: StudyPlansView;
  onOpenSource?: (sourceRefId: string) => void;
}

export const StudyPlansTab: React.FC<StudyPlansTabProps> = ({ initialView, onOpenSource }) => {
  const [view, setView] = useState<StudyPlansView>(initialView || { name: 'home' });
  const [cardGap, setCardGap] = useState<KnowledgeGapView | null>(null);
  const selectPlanAction = useLearningPathsStore((s) => s.selectPlan);
  const activePlanDetail = useLearningPathsStore((s) => s.activePlanDetail);

  useDestinationAction('study-plans', async (request) => {
    if (request.action === 'home') {
      setView({ name: 'home' });
      settleDestinationAction(request.id);
    } else if (request.action === 'create') {
      setView({ name: 'create', prefill: request.prefill });
      settleDestinationAction(request.id);
    } else if (request.action === 'open-plan') {
      try {
        await selectPlanAction(request.planId);
        setView({ name: 'plan', planId: request.planId, nodeId: request.nodeId });
        settleDestinationAction(request.id);
      } catch (err) {
        settleDestinationAction(
          request.id,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    } else if (request.action === 'open-blueprint') {
      setView({ name: 'assessment-builder', blueprintRevisionId: request.blueprintId });
    } else if (request.action === 'resume-attempt') {
      setView({ name: 'attempt-runner', attemptId: request.attemptId });
    }
  });

  // If not running in Tauri native desktop/mobile, refuse persistent operations
  if (!isTauri()) {
    return <StudyPlanStateNotice type="unsupported_platform" />;
  }

  const handleOpenPlan = async (planId: string) => {
    try {
      await selectPlanAction(planId);
      setView({ name: 'plan', planId });
    } catch {
      // Handled in store
    }
  };

  const handleCreateSuccess = (detail: StudyPlanDetail) => {
    setView({ name: 'plan', planId: detail.plan.id });
    void selectPlanAction(detail.plan.id, detail.version.id).catch(() => undefined);
  };

  if (view.name === 'create') {
    return (
      <StudyPlanCreateForm
        initialPrefill={view.prefill}
        onSuccess={handleCreateSuccess}
        onCancel={() => setView({ name: 'home' })}
      />
    );
  }

  if (view.name === 'assessment-history') {
    return (
      <AttemptHistoryView
        onBack={() => setView({ name: 'home' })}
        onSelect={(attemptId) => setView({ name: 'attempt-results', attemptId, fromHistory: true })}
        onResume={(attemptId) => setView({ name: 'attempt-runner', attemptId, fromHistory: true })}
      />
    );
  }

  if (view.name === 'attempt-runner') {
    return (
      <AttemptRunnerView
        attemptId={view.attemptId}
        returnContext={view.returnContext ?? null}
        onComplete={(completed) =>
          setView({ name: 'attempt-results', attemptId: completed.attempt.id, fromHistory: view.fromHistory, planId: view.planId, returnContext: view.returnContext ?? null })
        }
        onExit={() =>
          setView(view.planId ? { name: 'plan', planId: view.planId } : { name: view.fromHistory ? 'assessment-history' : 'home' })
        }
      />
    );
  }

  if (view.name === 'attempt-results') {
    return (
      <AttemptResultsView
        attemptId={view.attemptId}
        returnContext={view.returnContext ?? null}
        onBack={() =>
          setView(view.planId ? { name: 'plan', planId: view.planId } : { name: view.fromHistory ? 'assessment-history' : 'home' })
        }
        onRetake={(newDetail) =>
          setView({ name: 'attempt-runner', attemptId: newDetail.attempt.id, fromHistory: view.fromHistory, planId: view.planId, returnContext: view.returnContext ?? null })
        }
      />
    );
  }

  if (view.name === 'assessment-builder') {
    return (
      <AssessmentBuilder
        planDetail={activePlanDetail?.plan.id === view.planId ? activePlanDetail : null}
        blueprintRevisionId={view.blueprintRevisionId}
        initialMode={view.initialConfig?.mode}
        initialConfig={view.initialConfig}
        initialTitle={view.initialTitle}
        returnContext={view.returnContext ?? null}
        onClose={() => setView(view.planId ? { name: 'plan', planId: view.planId } : { name: 'home' })}
        onStartAssessment={(attemptId) => setView({ name: 'attempt-runner', attemptId, planId: view.planId, returnContext: view.returnContext ?? null })}
      />
    );
  }

  if (view.name === 'plan-home' && activePlanDetail?.plan.id === view.planId) {
    return (
      <PlanHomeTab
        planDetail={activePlanDetail}
        onBack={() => setView({ name: 'plan', planId: view.planId })}
        onContinue={(nodeId) => {
          void selectPlanAction(view.planId);
          setView({ name: 'plan', planId: view.planId, nodeId });
        }}
        onOpenPath={() => setView({ name: 'plan', planId: view.planId })}
        onOpenReview={() => {
          // Enter the Review destination; the create-card action is the only
          // review destination action and still lands on the Review tab.
          void requestDestinationAction({ destination: 'review', action: 'create-card' });
        }}
      />
    );
  }

  if (view.name === 'plan' && activePlanDetail?.plan.id === view.planId) {
    const sourceRefs = Object.values(activePlanDetail.sourceRefs)
      .filter((resolution) => resolution?.status === 'current')
      .map((resolution) => resolution.ref)
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
    const diagnosticSlot = (
      <DiagnosticChoice
        onTake={() =>
          setView({
            name: 'assessment-builder',
            planId: activePlanDetail.plan.id,
            versionId: activePlanDetail.version.id,
            initialConfig: buildPlanDiagnosticConfig(activePlanDetail),
            returnContext: {
              planId: activePlanDetail.plan.id,
              nodeId: null,
              gapId: null,
              versionId: activePlanDetail.version.id,
              sourceAttemptId: null,
            },
          })
        }
        onSkip={() => undefined}
      />
    );
    return (
      <>
        <StudyPlanEditor
          planDetail={activePlanDetail}
          initialNodeId={view.nodeId}
          onBack={() => setView({ name: 'home' })}
          onOpenSource={onOpenSource}
          onOpenPlanHome={() => setView({ name: 'plan-home', planId: activePlanDetail.plan.id })}
          onOpenAssessmentBuilder={(planId, versionId, blueprintRevisionId, initialConfig, initialTitle) =>
            setView({ name: 'assessment-builder', planId, versionId, blueprintRevisionId, initialConfig, initialTitle })
          }
          onPrepareAssessment={(gap, mode, options) => {
            const { plan, version } = activePlanDetail;
            const context = contextFromGap(gap, { planVersionId: version.id, sourceScope: version.sourceScope });
            setView({
              name: 'assessment-builder',
              planId: plan.id,
              versionId: version.id,
              initialConfig: mode === 'practice' ? buildTargetedPracticeConfig(context, options) : buildFollowUpExamConfig(context),
              returnContext: { planId: plan.id, nodeId: gap.nodeId, gapId: gap.id, versionId: version.id, sourceAttemptId: null },
            });
          }}
          onProposeCards={(gap) => setCardGap(gap)}
          diagnosticSlot={diagnosticSlot}
        />
        {cardGap && (() => {
          const excerpt = sourceRefs[0]?.excerpt ?? '';
          const drafts = [{
            question: `What is "${cardGap.conceptName}"?`,
            answer: `The verified source explains ${cardGap.conceptName}.`,
            conceptKeys: [cardGap.conceptName],
            evidenceQuote: excerpt.slice(0, 300),
          }];
          const stub = { id: `rec_${cardGap.id}`, kind: 'card-proposals' } as never;
          const adapted = adaptRemediationToCardProposals(
            stub,
            sourceRefs,
            drafts,
            { planId: activePlanDetail.plan.id, nodeId: cardGap.nodeId ?? undefined }
          );
          return (
            <LearnThisProposalSheet
              open
              text={cardGap.conceptName}
              passage={excerpt}
              documentId={sourceRefs[0]?.documentId}
              documentTitle={sourceRefs[0]?.documentTitle}
              staticCandidates={adapted.proposals.map((p) => ({
                question: p.candidate.question,
                answer: p.candidate.answer,
                conceptKeys: p.candidate.conceptKeys,
                evidenceQuote: p.candidate.evidenceQuote,
              }))}
              staticProvenance={{ provider: 'study-plan-remediation', modelClass: 'full' }}
              acceptance={{ acceptanceId: adapted.acceptanceId, perCandidateProposalIds: adapted.perCandidateProposalIds }}
              link={{ planId: activePlanDetail.plan.id, nodeId: cardGap.nodeId ?? undefined }}
              onClose={() => setCardGap(null)}
            />
          );
        })()}
      </>
    );
  }

  return (
    <StudyPlanList
      onCreateClick={() => setView({ name: 'create' })}
      onOpenPlan={handleOpenPlan}
      onOpenAssessmentHistory={() => setView({ name: 'assessment-history' })}
    />
  );
};
