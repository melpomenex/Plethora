/**
 * Plan Home / Today view (task 1.2 surface).
 *
 * Shows the projection recommendation as a primary Continue action with an
 * explainable reason, a separate due-review entry with a real count or an
 * unavailable state, and the ordered path with blocked dependents still
 * visible. Coverage/activity/demonstrated evidence remain separated.
 */

import React from 'react';
import { ArrowRight, CalendarCheck, Sparkle, Warning } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import { projectPlanHome } from '../../../lib/study-plans/home/projection';
import { ContextMenu, type ContextMenuItem } from '../../common/ContextMenu';
import { useStudyPlanContextMenu } from '../useStudyPlanContextMenu';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


const contextMenuId = 'study-plan-home-context-menu';

export interface PlanHomeViewProps {
  planDetail: StudyPlanDetail;
  dueReviewCount?: number | null;
  onContinue: (nodeId: string) => void;
  onOpenReview: () => void;
  onOpenPath: () => void;
}

export const PlanHomeView: React.FC<PlanHomeViewProps> = ({
  planDetail,
  dueReviewCount,
  onContinue,
  onOpenReview,
  onOpenPath,
}) => {
        useI18n();
        const contextMenu = useStudyPlanContextMenu(contextMenuId);
  const projection = projectPlanHome(planDetail, { dueReviewCount });
  const { recommendation } = projection;

  return (
    <div ref={contextMenu.ownerRef} tabIndex={-1} className="space-y-4" aria-label={translateRecentFeature("studyPlans.ui.plan-home.de5b1d7a")}>
      <section
        tabIndex={0}
        onContextMenu={(event) => {
                    const items: ContextMenuItem[] = recommendation.nodeId
            ? [
                { id: 'continue-topic', label: translateRecentFeature("studyPlans.ui.continue.41e55474"), onClick: () => onContinue(recommendation.nodeId!) },
                { id: 'browse-path', label: translateRecentFeature("studyPlans.ui.browse-path.993988b0"), onClick: onOpenPath },
              ]
            : [];
          contextMenu.openMenu(event, items);
        }}
        className="rounded-2xl border border-primary-500/30 bg-primary-500/5 p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-primary-700 dark:text-primary-300 uppercase tracking-wide">
          <Sparkle size={14} />
          <span>{translateRecentFeature("dateRange.today")}</span>
        </div>
        {recommendation.nodeId ? (
          <>
            <div>
              <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {recommendation.title}
              </h3>
              <p className="text-sm text-surface-600 dark:text-surface-300">
                {translateRecentFeature(recommendation.reasonLabelKey)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="filled" size="sm" onClick={() => onContinue(recommendation.nodeId!)}>
                <span>{translateRecentFeature("studyPlans.ui.continue.41e55474")}</span>
                <ArrowRight size={16} />
              </Button>
              <Button variant="tonal" size="sm" onClick={onOpenPath}>
                <span>{translateRecentFeature("studyPlans.ui.browse-path.993988b0")}</span>
              </Button>
            </div>
            {recommendation.blockedDependents.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                <Warning size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  {translateRecentFeature("studyPlans.ui.waiting-on-this-topic.3062c79e")}{' '}
                  {recommendation.blockedDependents.map((d) => d.title).join(', ')}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-surface-600 dark:text-surface-300">
            {translateRecentFeature(recommendation.reasonLabelKey)}
          </p>
        )}
      </section>

      <section
        tabIndex={0}
        onContextMenu={(event) => {
                    return contextMenu.openMenu(event, [
          { id: 'review-due', label: translateRecentFeature("tabs.review"), onClick: onOpenReview },
        ]);
        }}
        className="rounded-2xl border border-surface-200 dark:border-surface-700 p-4 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <CalendarCheck size={18} className="text-primary-500" />
          <div>
            <div className="text-xs font-semibold text-surface-700 dark:text-surface-200">{translateRecentFeature("studyPlans.ui.due-reviews.fc994bca")}</div>
            <div className="text-sm text-surface-500">
              {projection.dueReviewCount == null ? translateRecentFeature("studyPlans.ui.unavailable.a79c5108") : translateRecentFeature("i18nAudit.ui.var0-due.f33c0abe", {var0: projection.dueReviewCount})}
            </div>
          </div>
        </div>
        <Button variant="outlined" size="sm" onClick={onOpenReview}>
          <span>{translateRecentFeature("tabs.review")}</span>
        </Button>
      </section>
      <ContextMenu
        menuId={contextMenu.menuId}
        items={contextMenu.items}
        visible={contextMenu.visible}
        position={contextMenu.position}
        onClose={contextMenu.closeMenu}
      />
    </div>
  );
};
