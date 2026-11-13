/**
 * Plan Version History component for inspecting previous versions and restoring drafts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React from 'react';
import { Copy, Eye } from '@phosphor-icons/react';
import type { StudyPlanVersion } from '../../types/learningPaths';
import { Button } from '../md3/Button';
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { useStudyPlanContextMenu } from './useStudyPlanContextMenu';

const contextMenuId = 'study-plan-version-context-menu';

export interface PlanVersionSummary {
  id: string;
  version: number;
  state: StudyPlanVersion['state'];
  createdBy: StudyPlanVersion['createdBy'];
  createdAt: string;
  publishedAt: string | null;
  nodeCount: number;
}

export interface PlanVersionHistoryProps {
  versions: PlanVersionSummary[];
  activeVersionId: string;
  onSelectVersion: (versionId: string) => void;
  onCopyToDraft?: (versionId: string) => void;
  canCreateDraft?: boolean;
}

export const PlanVersionHistory: React.FC<PlanVersionHistoryProps> = ({
  versions,
  activeVersionId,
  onSelectVersion,
  onCopyToDraft,
  canCreateDraft = true,
}) => {
  const contextMenu = useStudyPlanContextMenu(contextMenuId);

  if (versions.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-surface-500">
        No version history available for this study plan.
      </div>
    );
  }

  const renderStateBadge = (state: StudyPlanVersion['state']) => {
    switch (state) {
      case 'published':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            Published Head
          </span>
        );
      case 'draft':
        return (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Draft
          </span>
        );
      case 'superseded':
        return (
          <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400">
            Superseded
          </span>
        );
    }
  };

  return (
    <div ref={contextMenu.ownerRef} tabIndex={-1} className="space-y-3">
      <div className="text-xs text-surface-500 pb-1">
        Historical versions are immutable. You can copy an older version into an active draft to
        revert or make modifications.
      </div>

      <div className="space-y-2">
        {versions.map((v) => {
          const isSelected = activeVersionId === v.id;
          const menuItems: ContextMenuItem[] = [];
          if (!isSelected) {
            menuItems.push({
              id: 'view-version',
              label: 'View',
              icon: <Eye size={16} />,
              onClick: () => onSelectVersion(v.id),
            });
          }
          if (v.state !== 'draft' && onCopyToDraft && canCreateDraft) {
            menuItems.push({
              id: 'copy-version-to-draft',
              label: 'Copy to draft',
              icon: <Copy size={16} />,
              onClick: () => onCopyToDraft(v.id),
            });
          }

          return (
            <div
              key={v.id}
              tabIndex={0}
              onContextMenu={(event) => contextMenu.openMenu(event, menuItems)}
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl border text-xs transition-colors ${
                isSelected
                  ? 'bg-primary-500/10 border-primary-500/40 shadow-sm'
                  : 'bg-surface-50 dark:bg-surface-800/60 border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-surface-900 dark:text-surface-100">
                    Version {v.version}
                  </span>
                  {renderStateBadge(v.state)}
                  <span className="text-[11px] text-surface-400 font-mono">
                    via {v.createdBy}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-surface-500">
                  <span>{v.nodeCount} topics</span>
                  {v.publishedAt ? (
                    <span>Published {new Date(v.publishedAt).toLocaleDateString()}</span>
                  ) : (
                    <span>Created {new Date(v.createdAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                <Button
                  variant={isSelected ? 'filled' : 'tonal'}
                  size="sm"
                  onClick={() => onSelectVersion(v.id)}
                >
                  <Eye size={15} />
                  <span>{isSelected ? 'Viewing' : 'View'}</span>
                </Button>

                {v.state !== 'draft' && onCopyToDraft && canCreateDraft && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => onCopyToDraft(v.id)}
                    title="Copy this version as active draft"
                  >
                    <Copy size={15} />
                    <span>Copy to draft</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
