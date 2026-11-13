/**
 * Study Plans Dashboard Card.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §2.3, §3 (Dashboard)
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T11)
 *
 * Displays up to three persisted active study plans with goal, depth, progress,
 * and quick-navigation actions into the Study Plans workspace.
 */

import React, { useEffect, useState } from 'react';
import { ArrowRight, GraduationCap, Plus } from '@phosphor-icons/react';
import { listStudyPlans } from '../../api/study-plans';
import { requestDestinationAction } from '../../commandPalette/destinationActions';
import { isTauri } from '../../lib/tauri';
import type { StudyPlanSummary } from '../../types/learningPaths';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";
import { studyErrorMessage } from "../../lib/study-plans/studyErrorMessage";


export interface StudyPlansDashboardCardProps {
  className?: string;
}

export const StudyPlansDashboardCard: React.FC<StudyPlansDashboardCardProps> = ({ className = '' }) => {
        useI18n();
        const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const dispatchAction = (action: Parameters<typeof requestDestinationAction>[0]) => {
    setNavigationError(null);
    void requestDestinationAction(action).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setNavigationError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    });
  };

  useEffect(() => {
    if (!isTauri()) return;

    let mounted = true;
    setIsLoading(true);

    listStudyPlans(false)
      .then((summaries) => {
        if (!mounted) return;
        setPlans(summaries.slice(0, 3));
        setError(null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleOpenHome = () => {
    dispatchAction({ destination: 'study-plans', action: 'home' });
  };

  const handleCreate = () => {
    dispatchAction({ destination: 'study-plans', action: 'create' });
  };

  const handleOpenPlan = (planId: string) => {
    dispatchAction({ destination: 'study-plans', action: 'open-plan', planId });
  };

  if (!isTauri()) {
    return null;
  }

  return (
    <div
      data-testid="study-plans-dashboard-card"
      className={`bg-card border border-border rounded-xl p-5 flex flex-col justify-between ${className}`}
    >
      <div>
        {navigationError && <p role="alert" className="text-xs text-destructive mb-2">{navigationError}</p>}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-base">{translateRecentFeature("palette.destination.studyPlans")}</h3>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline cursor-pointer"
            aria-label={translateRecentFeature("studyPlans.ui.create-study-plan.79b4bfe3")}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{translateRecentFeature("studyPlans.ui.new-plan.793f7d79")}</span>
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2.5 py-2">
            <div className="h-10 bg-muted/50 rounded-lg animate-pulse" />
            <div className="h-10 bg-muted/50 rounded-lg animate-pulse" />
          </div>
        ) : error ? (
          <p className="text-xs text-destructive py-2">{error}</p>
        ) : plans.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground mb-3">
              {translateRecentFeature("studyPlans.ui.no-active-study-plans-build-.da9315b2")}</p>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{translateRecentFeature("studyPlans.ui.create-first-plan.8ac25563")}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {plans.map((plan) => (
              <div
                key={plan.id}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenPlan(plan.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenPlan(plan.id);
                  }
                }}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 hover:border-primary/50 hover:bg-muted/40 transition-colors cursor-pointer text-left"
              >
                <div className="min-w-0 pr-2">
                  <h4 className="text-sm font-medium text-foreground truncate">{plan.title}</h4>
                  <p className="text-xs text-muted-foreground truncate">{plan.goal}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {plan.depth}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 mt-3 border-t border-border/50 flex justify-end">
        <button
          type="button"
          onClick={handleOpenHome}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
        >
          <span>{translateRecentFeature("studyPlans.ui.view-all-study-plans.6f658e2f")}</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
