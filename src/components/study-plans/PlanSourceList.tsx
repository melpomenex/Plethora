/**
 * Plan Source List component for rendering grounded citations and navigation handles.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React from 'react';
import {
  FileText,
  ArrowSquareOut,
  Trash,
  CheckCircle,
  Warning,
  XCircle,
  Question,
} from '@phosphor-icons/react';
import type { StudySourceResolution } from '../../types/studySource';
import { Button } from '../md3/Button';
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from '../common/ContextMenu';
import { useStudyPlanContextMenu } from './useStudyPlanContextMenu';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


const contextMenuId = 'study-plan-source-context-menu';

export interface PlanSourceListProps {
  sourceRefIds: string[];
  sourceResolutions?: Record<string, StudySourceResolution>;
  onOpenSource?: (sourceRefId: string, resolution?: StudySourceResolution) => void;
  onRemoveSource?: (sourceRefId: string) => void;
  isReadOnly?: boolean;
}

export const PlanSourceList: React.FC<PlanSourceListProps> = ({
  sourceRefIds,
  sourceResolutions = {},
  onOpenSource,
  onRemoveSource,
  isReadOnly = false,
}) => {
        useI18n();
        const contextMenu = useStudyPlanContextMenu(contextMenuId);

  if (sourceRefIds.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-surface-500 border border-dashed border-surface-200 dark:border-surface-700 rounded-xl">
        {translateRecentFeature("studyPlans.ui.no-source-material-linked-to.eb745b27")}</div>
    );
  }

  const renderStatusBadge = (status?: StudySourceResolution['status']) => {
        switch (status) {
      case 'current':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle size={12} weight="fill" />
            {translateRecentFeature("studyPlans.ui.current.e40f6471")}</span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Warning size={12} weight="fill" />
            {translateRecentFeature("studyPlans.ui.stale-revision.75e5ea66")}</span>
        );
      case 'missing':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
            <XCircle size={12} weight="fill" />
            {translateRecentFeature("studyPlans.ui.document-missing.61f55161")}</span>
        );
      case 'ambiguous':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            <Question size={12} weight="fill" />
            {translateRecentFeature("studyPlans.ui.multiple-matches.15aecfea")}</span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
            {translateRecentFeature("studyPlans.ui.unverified.f00b7954")}</span>
        );
    }
  };

  return (
    <div ref={contextMenu.ownerRef} tabIndex={-1} className="space-y-2">
      {sourceRefIds.map((refId) => {
                const resolution = sourceResolutions[refId];
        const title = resolution?.ref?.documentTitle || translateRecentFeature("studyPlans.ui.source-reference-var0.36273e58", {var0: refId.slice(0, 8)});
        const excerpt = resolution?.ref?.excerpt;
        const jump = resolution?.ref?.jump;
        let locatorLabel: string | null = null;
        if (jump) {
          if (jump.kind === 'pdf') {
            locatorLabel = translateRecentFeature("studyPlans.ui.page-var0.cc5cd104", {var0: jump.pageNumber});
          } else if (jump.kind === 'epub') {
            locatorLabel = translateRecentFeature("studyPlans.ui.epub-section.d8890a2e");
          } else if (jump.kind === 'youtube' || jump.kind === 'audio') {
            locatorLabel = `${Math.floor(jump.timeSeconds)}s`;
          } else if (jump.kind === 'markdown' || jump.kind === 'html') {
            if (jump.scrollPercent !== undefined) {
              locatorLabel = `${Math.round(jump.scrollPercent * 100)}%`;
            }
          }
        }

        const menuItems: ContextMenuItem[] = [];
        if (onOpenSource && resolution?.status !== 'missing') {
          menuItems.push({
            id: 'open-source',
            label: translateRecentFeature("audio.openSource"),
            icon: <ArrowSquareOut size={16} />,
            onClick: () => onOpenSource(refId, resolution),
          });
        }
        if (!isReadOnly && onRemoveSource) {
          menuItems.push({
            id: 'remove-link',
            type: ContextMenuItemType.Danger,
            label: translateRecentFeature("studyPlans.ui.remove-link.b8cff531"),
            icon: <Trash size={16} />,
            onClick: () => onRemoveSource(refId),
          });
        }

        return (
          <div
            key={refId}
            tabIndex={0}
            onContextMenu={(event) => contextMenu.openMenu(event, menuItems)}
            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-surface-100 dark:bg-surface-800/80 border border-surface-200 dark:border-surface-700 text-xs"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <FileText size={15} className="text-primary-500 flex-shrink-0" />
                <span className="font-semibold text-surface-900 dark:text-surface-100 truncate">
                  {title}
                </span>
                {locatorLabel && (
                  <span className="text-[11px] text-surface-500 font-mono">
                    {locatorLabel}
                  </span>
                )}
                {renderStatusBadge(resolution?.status)}
              </div>

              {excerpt && (
                <p className="text-[11px] text-surface-600 dark:text-surface-400 line-clamp-2 italic pl-5 border-l-2 border-surface-300 dark:border-surface-600 my-1">
                  &ldquo;{excerpt}&rdquo;
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 self-end sm:self-center flex-shrink-0">
              {onOpenSource && resolution?.status !== 'missing' && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => onOpenSource(refId, resolution)}
                  title={translateRecentFeature("studyPlans.ui.open-source-in-reader.057f9bf3")}
                >
                  <ArrowSquareOut size={15} />
                  <span>{translateRecentFeature("mainLayout.open")}</span>
                </Button>
              )}
              {!isReadOnly && onRemoveSource && (
                <Button
                  variant="text"
                  size="iconSm"
                  onClick={() => onRemoveSource(refId)}
                  title={translateRecentFeature("studyPlans.ui.remove-source-link.3399ed49")}
                  aria-label={translateRecentFeature("studyPlans.ui.remove-source-link.3399ed49")}
                >
                  <Trash size={15} className="text-red-500" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
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
