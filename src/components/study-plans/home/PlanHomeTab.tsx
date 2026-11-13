/**
 * Plan Home tab adapter: fetches today's real due-review counts and renders the
 * PlanHomeView projection with navigation callbacks.
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { StudyPlansScrollContainer } from '../StudyPlansScrollContainer';
import { PlanHomeView } from './PlanHomeView';
import { getWorkloadData } from '../../../api/analytics';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface PlanHomeTabProps {
  planDetail: StudyPlanDetail;
  onBack: () => void;
  onContinue: (nodeId: string) => void;
  onOpenPath: () => void;
  onOpenReview: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const PlanHomeTab: React.FC<PlanHomeTabProps> = ({
  planDetail,
  onBack,
  onContinue,
  onOpenPath,
  onOpenReview,
}) => {
    useI18n();
    const [dueReviewCount, setDueReviewCount] = useState<number | null>(null);

  useEffect(() => {
    let stale = false;
    const today = todayIso();
    void getWorkloadData(today, today).then(
      (days) => {
        if (stale) return;
        const total = days.reduce((sum, day) => sum + (day.due_count ?? 0), 0);
        setDueReviewCount(total);
      },
      () => {
        if (!stale) setDueReviewCount(null);
      }
    );
    return () => { stale = true; };
  }, []);

  return (
    <StudyPlansScrollContainer className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4" data-study-plans-scroll="plan-home">
      <div className="flex items-center gap-3 pb-3 border-b border-surface-200 dark:border-surface-700">
        <Button variant="text" size="iconSm" onClick={onBack} aria-label={translateRecentFeature("studyPlans.ui.back-to-plan.2822cd13")}>
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">{planDetail.plan.title}</h2>
          <p className="text-xs text-surface-500">{translateRecentFeature("studyPlans.ui.plan-home-today.1c76014c")}</p>
        </div>
      </div>
      <PlanHomeView
        planDetail={planDetail}
        dueReviewCount={dueReviewCount}
        onContinue={onContinue}
        onOpenReview={onOpenReview}
        onOpenPath={onOpenPath}
      />
    </StudyPlansScrollContainer>
  );
};
