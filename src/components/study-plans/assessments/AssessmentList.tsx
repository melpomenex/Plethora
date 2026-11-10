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
  Sparkle,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { BlueprintSummary } from '../../../types/assessmentQuestions';
import { BlueprintService } from '../../../lib/study-plans/assessments/blueprintService';

export interface AssessmentListProps {
  planId?: string | null;
  onSelectBlueprint: (blueprintId: string, revisionId?: string) => void;
  onCreateNew: () => void;
  className?: string;
}

export const AssessmentList: React.FC<AssessmentListProps> = ({
  planId,
  onSelectBlueprint,
  onCreateNew,
  className = '',
}) => {
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
      setError(err?.messageKey || err?.message || 'Failed to load assessments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBlueprints();
  }, [planId]);

  const handleArchive = async (bp: BlueprintSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await BlueprintService.archiveBlueprint(bp.id, bp.currentRevision);
      await loadBlueprints();
    } catch (err: any) {
      setError(err?.messageKey || err?.message || 'Failed to archive assessment');
    }
  };

  const handleDelete = async (bp: BlueprintSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await BlueprintService.deleteUnusedBlueprint(bp.id, bp.currentRevision);
      await loadBlueprints();
    } catch (err: any) {
      setError(err?.messageKey || err?.message || 'Failed to delete assessment');
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            Assessments & Examinations
          </h3>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            Source-grounded diagnostic assessments, exams, and practice tests.
          </p>
        </div>

        <Button variant="filled" size="sm" onClick={onCreateNew}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create Assessment
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xs text-surface-400">Loading assessments…</div>
      ) : blueprints.length === 0 ? (
        <div className="p-10 text-center rounded-2xl border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/20 space-y-3">
          <BookOpen className="w-10 h-10 mx-auto text-surface-300 dark:text-surface-600" />
          <div>
            <h4 className="text-sm font-semibold text-surface-800 dark:text-surface-200">
              No Assessments Yet
            </h4>
            <p className="text-xs text-surface-500 max-w-sm mx-auto mt-1">
              Create an AI-generated or custom examination paper grounded directly in your study plan sources.
            </p>
          </div>
          <Button variant="outlined" size="sm" onClick={onCreateNew}>
            <Sparkle className="w-4 h-4 mr-1.5 text-primary-600" />
            Generate First Assessment
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {blueprints.map((bp) => {
            const isExam = bp.mode === 'exam';
            const isReady = bp.state === 'ready';

            return (
              <div
                key={bp.id}
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
                      {isExam ? 'Exam' : 'Practice'}
                    </span>
                    <span>•</span>
                    <span>{bp.questionCount} Questions</span>
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
                      title="Archive Assessment"
                      className="p-1 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(bp, e)}
                      title="Delete Assessment"
                      className="p-1 rounded text-surface-400 hover:text-red-600 hover:bg-surface-200 dark:hover:bg-surface-700"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="text-xs font-medium text-primary-600 dark:text-primary-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    Open <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
