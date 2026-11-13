/**
 * Legacy Study Plan Import UI component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §9.1
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.1
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T08)
 */

import React, { useState, useEffect } from 'react';
import { Database, Warning, ArrowRight, SpinnerGap } from '@phosphor-icons/react';
import {
  previewLegacyLearningPathsImport,
  executeLegacyLearningPathsImport,
  type LegacyImportPreview,
} from '../../lib/study-plans/legacyLearningPathsImport';
import { Button } from '../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";
import { studyErrorMessage } from "../../lib/study-plans/studyErrorMessage";

function legacyDefectMessageKey(code: LegacyImportPreview["defects"][number]["code"]): string {
  switch (code) {
    case "newer_version": return "studyPlans.ui.legacy-import-newer-version";
    case "unknown_goal": return "studyPlans.ui.legacy-import-unknown-goal";
    case "duplicate_node": return "studyPlans.ui.legacy-import-duplicate-topic";
    case "cycle": return "studyPlans.ui.legacy-import-cycle";
    case "dangling_prerequisite": return "studyPlans.ui.legacy-import-dangling-prerequisite";
    case "malformed_structure": return "studyPlans.ui.legacy-import-malformed-structure";
  }
}


export interface LegacyStudyPlanImportProps {
  onImportSuccess?: () => void;
  storage?: Storage;
}

export const LegacyStudyPlanImport: React.FC<LegacyStudyPlanImportProps> = ({
  onImportSuccess,
  storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage),
}) => {
        useI18n();
        const [preview, setPreview] = useState<LegacyImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const prev = previewLegacyLearningPathsImport(storage);
      if (prev.hasData) {
        setPreview(prev);
      } else {
        setPreview(null);
      }
    } catch {
      setPreview(null);
    }
  }, [storage]);

  if (!preview || !preview.hasData) {
    return null;
  }

  const handleImport = async () => {
    setIsImporting(true);
    setStatusMessage(null);
    try {
      const res = await executeLegacyLearningPathsImport(storage);
      if (res.ok) {
        setStatusMessage(translateRecentFeature("studyPlans.ui.legacy-import-success", {
          var0: res.importedNodeCount ?? 0,
        }));
        onImportSuccess?.();
        // Refresh preview after successful import (backup key now created)
        const updated = previewLegacyLearningPathsImport(storage);
        setPreview(updated.hasData ? updated : null);
      } else {
        setStatusMessage(studyErrorMessage(res.error, translateRecentFeature("studyPlans.ui.operation-failed")));
      }
    } catch (err: any) {
      setStatusMessage(studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      role="region"
      aria-label={translateRecentFeature("studyPlans.ui.legacy-learning-paths-import.e05d7475")}
      className="p-5 mb-6 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/30 shadow-sm"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Database size={22} />
        </div>

        <div className="flex-1">
          <h4 className="text-base font-bold text-surface-900 dark:text-surface-100 mb-1">
            {translateRecentFeature("studyPlans.ui.previous-learning-paths-dete.38ad2571")}</h4>
          <p className="text-xs text-surface-600 dark:text-surface-400 mb-3 leading-relaxed">{translateRecentFeature("studyPlans.ui.found-var0-learning-path-s-a.43210da0", {var0: preview.totalPaths, var1: preview.totalGoals})}</p>

          {preview.defects.length > 0 && (
            <div className="mb-3 p-3 rounded-xl bg-surface-100 dark:bg-surface-800 text-xs text-amber-700 dark:text-amber-300">
              <div className="font-semibold mb-1 flex items-center gap-1.5">
                <Warning size={14} />
                <span>{translateRecentFeature("studyPlans.ui.issues-noted-in-legacy-data.ac404212")}</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {preview.defects.slice(0, 3).map((d, i) => (
                  <li key={i}>{translateRecentFeature(legacyDefectMessageKey(d.code))}</li>
                ))}
                {preview.defects.length > 3 && (
                  <li>{translateRecentFeature("studyPlans.ui.and-var0-more-issues.4db2f3b8", {var0: preview.defects.length - 3})}</li>
                )}
              </ul>
            </div>
          )}

          {statusMessage && (
            <div className="mb-3 text-xs font-semibold text-primary-600 dark:text-primary-400">
              {statusMessage}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="filled"
              size="sm"
              disabled={!preview.canImport || isImporting}
              onClick={handleImport}
            >
              {isImporting ? (
                <SpinnerGap size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              <span>{isImporting ? translateRecentFeature("studyPlans.ui.importing.703bf845") : translateRecentFeature("studyPlans.ui.import-accepted-items.4ba671ed")}</span>
            </Button>

            <span className="text-[11px] text-surface-500">{translateRecentFeature("studyPlans.ui.var0-of-var1-path-s-ready-to.9b184d35", {var0: preview.validPaths.length, var1: preview.totalPaths})}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
