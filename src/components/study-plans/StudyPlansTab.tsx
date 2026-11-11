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
import { useDestinationAction, settleDestinationAction } from '../../commandPalette/destinationActions';
import type { StudyPlanDetail } from '../../types/learningPaths';
import type { StudySourceRefInput } from '../../types/studySource';
import type { ReassessmentReturnContext } from './remediation/returnContext';

export type StudyPlansView =
  | { name: 'home' }
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
  | { name: 'plan'; planId: string; versionId?: string }
  | { name: 'assessment-builder'; planId?: string; versionId?: string; blueprintRevisionId?: string; returnContext?: ReassessmentReturnContext | null }
  | { name: 'attempt-runner'; attemptId: string; planId?: string; returnContext?: ReassessmentReturnContext | null }
  | { name: 'attempt-results'; attemptId: string; planId?: string; returnContext?: ReassessmentReturnContext | null };

export interface StudyPlansTabProps {
  initialView?: StudyPlansView;
  onOpenSource?: (sourceRefId: string) => void;
}

export const StudyPlansTab: React.FC<StudyPlansTabProps> = ({ initialView, onOpenSource }) => {
  const [view, setView] = useState<StudyPlansView>(initialView || { name: 'home' });
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
        setView({ name: 'plan', planId: request.planId });
        settleDestinationAction(request.id);
      } catch (err) {
        settleDestinationAction(
          request.id,
          err instanceof Error ? err : new Error(String(err))
        );
      }
    } else {
      settleDestinationAction(request.id);
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

  if (view.name === 'attempt-runner') {
    return (
      <AttemptRunnerView
        attemptId={view.attemptId}
        returnContext={view.returnContext ?? null}
        onComplete={(completed) =>
          setView({ name: 'attempt-results', attemptId: completed.attempt.id, planId: view.planId, returnContext: view.returnContext ?? null })
        }
        onExit={() =>
          setView(view.planId ? { name: 'plan', planId: view.planId } : { name: 'home' })
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
          setView(view.planId ? { name: 'plan', planId: view.planId } : { name: 'home' })
        }
        onRetake={(newDetail) =>
          setView({ name: 'attempt-runner', attemptId: newDetail.attempt.id, planId: view.planId, returnContext: view.returnContext ?? null })
        }
      />
    );
  }

  if (view.name === 'assessment-builder') {
    return (
      <AssessmentBuilder
        planDetail={activePlanDetail}
        blueprintRevisionId={view.blueprintRevisionId}
        returnContext={view.returnContext ?? null}
        onClose={() => setView(view.planId ? { name: 'plan', planId: view.planId } : { name: 'home' })}
        onStartAssessment={(attemptId) => setView({ name: 'attempt-runner', attemptId, planId: view.planId, returnContext: view.returnContext ?? null })}
      />
    );
  }

  if (view.name === 'plan' && activePlanDetail) {
    return (
      <StudyPlanEditor
        planDetail={activePlanDetail}
        onBack={() => setView({ name: 'home' })}
        onOpenSource={onOpenSource}
        onOpenAssessmentBuilder={(planId, versionId) =>
          setView({ name: 'assessment-builder', planId, versionId })
        }
      />
    );
  }

  return (
    <StudyPlanList
      onCreateClick={() => setView({ name: 'create' })}
      onOpenPlan={handleOpenPlan}
    />
  );
};
