/**
 * Assessment Blueprints List Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.5
 * - openspec/changes/generate-study-plan-examinations/ (C3-T08)
 */

import React, { useEffect, useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  Plus,
  Trash,
  Archive,
  ArrowRight,
  Clock,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { BlueprintSummary } from '../../../types/assessmentQuestions';
import { BlueprintService } from '../../../lib/study-plans/assessments/blueprintService';
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from '../../common/ContextMenu';
import { useStudyPlanContextMenu } from '../useStudyPlanContextMenu';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


const contextMenuId = 'study-plan-assessment-context-menu';

export interface AssessmentListProps {
  planId?: string | null;
  topics?: Array<{ nodeId: string; title: string }>;
  onSelectBlueprint: (blueprintId: string, revisionId?: string) => void;
  onCreateNew: () => void;
  onCreateForTopic?: (nodeId: string) => void;
  className?: string;
}

export const AssessmentList: React.FC<AssessmentListProps> = ({
  planId,
  topics = [],
  onSelectBlueprint,
  onCreateNew,
  onCreateForTopic,
  className = '',
}) => {
        useI18n();
        const contextMenu = useStudyPlanContextMenu(contextMenuId);
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBlueprints = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await BlueprintService.listBlueprints(planId);
      setBlueprints(list);
    } catch (err: any) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBlueprints();
  }, [planId]);

  const handleArchive = async (bp: BlueprintSummary, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await BlueprintService.archiveBlueprint(bp.id, bp.currentRevision);
      await loadBlueprints();
    } catch (err: any) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  const handleDelete = async (bp: BlueprintSummary, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await BlueprintService.deleteUnusedBlueprint(bp.id, bp.currentRevision);
      await loadBlueprints();
    } catch (err: any) {
      setError(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    }
  };

  return (
    <div ref={contextMenu.ownerRef} tabIndex={-1} className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            {translateRecentFeature("studyPlans.ui.assessments-examinations.e966bd86")}</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {translateRecentFeature("studyPlans.ui.saved-papers-stay-with-this-.a0cff592")}</p>
        </div>
      </div>

      <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30 p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100">{translateRecentFeature("studyPlans.ui.create-an-assessment.8f7f702f")}</h4>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            {translateRecentFeature("studyPlans.ui.a-plan-wide-paper-draws-ques.77225af0")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="filled" size="sm" onClick={onCreateNew} className="min-h-11">
            <Plus className="w-4 h-4 mr-1.5" />
            {translateRecentFeature("studyPlans.ui.create-for-all-topics.1e5dc94b")}</Button>
          {topics.length > 0 && onCreateForTopic && (
            <label className="flex w-full min-w-0 flex-col items-start gap-2 text-xs text-surface-600 dark:text-surface-300 sm:w-auto sm:flex-row sm:items-center">
              {translateRecentFeature("studyPlans.ui.or-create-for-one-topic.5f3d4bd3")}<select
                aria-label={translateRecentFeature("studyPlans.ui.create-assessment-for-a-topi.ac4c0f1b")}
                defaultValue=""
                onChange={(event) => {
                  const nodeId = event.currentTarget.value;
                  if (nodeId) onCreateForTopic(nodeId);
                  event.currentTarget.value = '';
                }}
                className="min-h-11 min-w-0 w-full max-w-full rounded-lg border border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-900 px-3 py-2 text-xs text-surface-800 dark:text-surface-100 sm:min-w-48 sm:w-auto"
              >
                <option value="" disabled>{translateRecentFeature("studyPlans.ui.select-a-topic.e06d9bdc")}</option>
                {topics.map((topic) => <option key={topic.nodeId} value={topic.nodeId}>{topic.title}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xs text-surface-400">{translateRecentFeature("studyPlans.ui.loading-assessments.ffdc160d")}</div>
      ) : blueprints.length === 0 ? (
        <div className="p-10 text-center rounded-2xl border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/20 space-y-3">
          <BookOpen className="w-10 h-10 mx-auto text-surface-300 dark:text-surface-600" />
          <div>
            <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
              {translateRecentFeature("studyPlans.ui.no-assessments-yet.343d33ba")}</h4>
            <p className="text-xs text-surface-500 max-w-sm mx-auto mt-1">
              {translateRecentFeature("studyPlans.ui.create-an-ai-generated-or-cu.2543d907")}</p>
          </div>
          <p className="text-xs text-surface-500">{translateRecentFeature("studyPlans.ui.choose-an-assessment-scope-a.0eb7f8d6")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {blueprints.map((bp) => {
                        const isExam = bp.mode === 'exam';
            const isReady = bp.state === 'ready';
            const menuItems: ContextMenuItem[] = [
              {
                id: 'open-assessment',
                label: translateRecentFeature("mainLayout.open"),
                icon: <ArrowRight size={16} />,
                onClick: () => onSelectBlueprint(bp.id, bp.currentRevisionId || undefined),
              },
              {
                id: 'archive-assessment',
                label: translateRecentFeature("cardContextMenu.archive"),
                icon: <Archive size={16} />,
                onClick: () => void handleArchive(bp),
              },
              {
                id: 'delete-unused-assessment',
                type: ContextMenuItemType.Danger,
                label: translateRecentFeature("studyPlans.ui.delete-unused-assessment.ef8c36d3"),
                icon: <Trash size={16} />,
                onClick: () => void handleDelete(bp),
              },
            ];

            return (
              <div
                key={bp.id}
                tabIndex={0}
                onContextMenu={(event) => contextMenu.openMenu(event, menuItems)}
                onClick={() => onSelectBlueprint(bp.id, bp.currentRevisionId || undefined)}
                className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40 hover:bg-surface-100 dark:hover:bg-surface-800/80 transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-primary-600 transition-colors truncate">
                      {bp.title}
                    </h4>
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                        isReady
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      }`}
                    >
                      {bp.state}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                    <span className="flex items-center gap-1">
                      {isExam ? (
                        <GraduationCap className="w-3.5 h-3.5 text-primary-600" />
                      ) : (
                        <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
                      )}
                      {isExam ? translateRecentFeature("studyPlans.ui.exam.e3bdca7e") : translateRecentFeature("studyPlans.ui.practice.e7940d9b")}
                    </span>
                    <span>•</span>
                    <span>{translateRecentFeature("studyPlans.ui.var0-questions.1fbbd3f3", {var0: bp.questionCount})}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Clock className="w-3 h-3" />
                      {new Date(bp.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-surface-200/60 dark:border-surface-700/60">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => handleArchive(bp, e)}
                      title={translateRecentFeature("studyPlans.ui.archive-assessment.6e8e0b12")}
                      className="p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(bp, e)}
                      title={translateRecentFeature("studyPlans.ui.delete-assessment.0645f3e2")}
                      className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-surface-200 dark:hover:bg-surface-700"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="text-xs font-medium text-primary-600 dark:text-primary-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    {translateRecentFeature("mainLayout.open")}<ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
