/**
 * Plan Outline component for the ordered curriculum list and safe DAG reordering.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React, { useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Lock,
  LockOpen,
  Plus,
  ArrowCounterClockwise,
  PlayCircle,
  Trash,
  Warning,
  CheckCircle,
  Circle,
  Prohibit,
} from '@phosphor-icons/react';
import type {
  StudyPlanVersionNode,
  PlanPrerequisite,
  NodeActivity,
} from '../../types/learningPaths';
import {
  reorderStudyPlanNode,
} from '../../lib/study-plans/topology';
import { Button } from '../md3/Button';
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from '../common/ContextMenu';
import { useStudyPlanContextMenu } from './useStudyPlanContextMenu';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


const contextMenuId = 'study-plan-outline-context-menu';

export interface PlanOutlineProps {
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  selectedNodeId: string | null;
  activityByNodeId?: Record<string, NodeActivity>;
  onSelectNode: (nodeId: string) => void;
  onChangeNodes: (updatedNodes: StudyPlanVersionNode[]) => void;
  onChangeNode?: (updatedNode: StudyPlanVersionNode) => void;
  onStartLesson?: (nodeId: string) => void;
  isReadOnly?: boolean;
}

export const PlanOutline: React.FC<PlanOutlineProps> = ({
  nodes,
  prerequisites,
  selectedNodeId,
  activityByNodeId = {},
  onSelectNode,
  onChangeNodes,
  onChangeNode,
  onStartLesson,
  isReadOnly = false,
}) => {
        useI18n();
        const [orderConflict, setOrderConflict] = useState<string | null>(null);
  const contextMenu = useStudyPlanContextMenu(contextMenuId);

  const includedNodes = nodes
    .filter((n) => n.included)
    .sort((a, b) => a.position - b.position);

  const tombstoneNodes = nodes.filter((n) => !n.included);

  const getMoveResult = (nodeId: string, delta: number) => {
    if (isReadOnly) return { ok: false as const, reason: translateRecentFeature("studyPlans.ui.cannot-move-plan-read-only") };
    const node = includedNodes.find((n) => n.nodeId === nodeId);
    if (!node) return { ok: false as const, reason: translateRecentFeature("studyPlans.ui.topic-unavailable") };

    const targetPos = node.position + delta;
    const reorderResult = reorderStudyPlanNode(nodes, prerequisites, nodeId, targetPos);

    if (!reorderResult.ok) {
      if (reorderResult.error.code === 'order_conflict') {
        const minP = (reorderResult.error.details?.minPosition ?? 0) + 1;
        const maxP = (reorderResult.error.details?.maxPosition ?? includedNodes.length - 1) + 1;
        return {
          ok: false as const,
          reason: translateRecentFeature("studyPlans.ui.cannot-move-topic-to-position", {
            title: node.title,
            position: targetPos + 1,
            minPosition: minP,
            maxPosition: maxP,
          }),
        };
      }
      return { ok: false as const, reason: translateRecentFeature(reorderResult.error.messageKey) };
    }

    const movedLockedNode = nodes.find((lockedNode) => {
      if (!lockedNode.included || !lockedNode.locked) return false;
      const updatedNode = reorderResult.value.find((candidate) => candidate.nodeId === lockedNode.nodeId);
      return updatedNode?.position !== lockedNode.position;
    });
    if (movedLockedNode) {
      return {
        ok: false as const,
        reason: translateRecentFeature("studyPlans.ui.topic-locked-to-position", {
          title: movedLockedNode.title,
          position: movedLockedNode.position + 1,
        }),
      };
    }

    return { ok: true as const, nodes: reorderResult.value };
  };

  const handleMove = (nodeId: string, delta: number) => {
    setOrderConflict(null);
    const result = getMoveResult(nodeId, delta);
    if (!result.ok) {
      setOrderConflict(result.reason);
      return;
    }
    onChangeNodes(result.nodes);
  };

  const handleNodeUpdate = (updatedNode: StudyPlanVersionNode) => {
    if (onChangeNode) {
      onChangeNode(updatedNode);
    } else {
      onChangeNodes(nodes.map((node) => node.nodeId === updatedNode.nodeId ? updatedNode : node));
    }
  };

  const buildTopicMenuItems = (node: StudyPlanVersionNode, included: boolean): ContextMenuItem[] => {
        const items: ContextMenuItem[] = [
      { id: 'open-topic', label: translateRecentFeature("studyPlans.ui.open-topic.77ee1567"), onClick: () => onSelectNode(node.nodeId) },
    ];

    if (!included) {
      if (!isReadOnly) {
        items.push({
          id: 'restore-topic',
          label: translateRecentFeature("mainLayout.restore"),
          icon: <ArrowCounterClockwise size={16} />,
          onClick: () => handleRestoreTombstone(node.nodeId),
        });
      }
      return items;
    }

    if (onStartLesson) {
      items.push({ id: 'start-lesson', label: translateRecentFeature("studyPlans.ui.start-lesson.a198f27f"), icon: <PlayCircle size={16} />, onClick: () => onStartLesson(node.nodeId) });
    }

    if (!isReadOnly) {
      items.push({ id: 'separator-topic-edit', type: ContextMenuItemType.Separator, label: '' });
      for (const [id, label, delta] of [
        ['move-earlier', 'Move earlier', -1],
        ['move-later', 'Move later', 1],
      ] as const) {
        const result = getMoveResult(node.nodeId, delta);
        items.push({
          id,
          label,
          disabled: !result.ok,
          title: result.ok ? undefined : result.reason,
          onClick: () => handleMove(node.nodeId, delta),
        });
      }
      items.push(
        {
          id: 'toggle-lock',
          label: node.locked ? 'Unlock' : 'Lock',
          icon: node.locked ? <LockOpen size={16} /> : <Lock size={16} />,
          onClick: () => handleNodeUpdate({ ...node, locked: !node.locked, userModified: true }),
        },
        {
          id: 'remove-topic',
          type: ContextMenuItemType.Danger,
          label: translateRecentFeature("studyPlans.ui.remove-from-plan.2085a375"),
          icon: <Trash size={16} />,
          onClick: () => handleNodeUpdate({ ...node, included: false, position: -1, userModified: true }),
        },
      );
    }

    return items;
  };

  const handleAddTopic = () => {
        if (isReadOnly || nodes.length >= 100) return;
    setOrderConflict(null);

    const newId = `spn_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPosition = includedNodes.length;

    const newNode: StudyPlanVersionNode = {
      nodeId: newId,
      title: translateRecentFeature("studyPlans.ui.topic-var0.7b244fd9", {var0: newPosition + 1}),
      summary: '',
      learningObjectives: ['Learn topic fundamentals'],
      conceptId: null,
      conceptLabel: `Topic ${newPosition + 1}`,
      position: newPosition,
      included: true,
      locked: false,
      userAdded: true,
      userModified: true,
      materialSupport: 'not-validated',
      whyHere: null,
      sourceRefIds: [],
    };

    onChangeNodes([...nodes, newNode]);
    onSelectNode(newId);
  };

  const handleRestoreTombstone = (nodeId: string) => {
    if (isReadOnly) return;
    setOrderConflict(null);

    const newPosition = includedNodes.length;
    const updated = nodes.map((n) =>
      n.nodeId === nodeId
        ? {
            ...n,
            included: true,
            position: newPosition,
            userModified: true,
          }
        : n
    );

    onChangeNodes(updated);
    onSelectNode(nodeId);
  };

  const renderActivityIcon = (act?: NodeActivity) => {
        switch (act) {
      case 'completed':
        return (
          <span title={translateRecentFeature("studyPlans.ui.completed.b0775abf")}>
            <CheckCircle size={15} weight="fill" className="text-emerald-500" />
          </span>
        );
      case 'in-progress':
        return (
          <span title={translateRecentFeature("studyPlans.ui.in-progress.3850f9d6")}>
            <PlayCircle size={15} className="text-blue-500" />
          </span>
        );
      case 'skipped':
        return (
          <span title={translateRecentFeature("studyPlans.ui.skipped.76bc3e23")}>
            <Prohibit size={15} className="text-amber-500" />
          </span>
        );
      default:
        return (
          <span title={translateRecentFeature("documentsView.notStarted")}>
            <Circle size={15} className="text-surface-400" />
          </span>
        );
    }
  };

  return (
    <div ref={contextMenu.ownerRef} tabIndex={-1} className="space-y-4">
      {orderConflict && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <Warning size={16} className="flex-shrink-0" />
            <span>{orderConflict}</span>
          </div>
          <button
            type="button"
            onClick={() => setOrderConflict(null)}
            className="text-amber-600 dark:text-amber-400 font-bold hover:underline"
          >
            {translateRecentFeature("queue.dismiss")}</button>
        </div>
      )}

      {/* Included ordered list */}
      <div
        role="list"
        aria-label={translateRecentFeature("studyPlans.ui.ordered-study-plan-topics.a8de237a")}
        className="space-y-2"
      >
        {includedNodes.length === 0 ? (
          <div className="py-8 text-center text-xs text-surface-500 border border-dashed border-surface-200 dark:border-surface-700 rounded-2xl">
            {translateRecentFeature("studyPlans.ui.no-active-topics-in-this-pla.479d6b03")}</div>
        ) : (
          includedNodes.map((n, idx) => {
                        const isSelected = selectedNodeId === n.nodeId;
            const activity = activityByNodeId[n.nodeId] || 'not-started';
            const isFirst = idx === 0;
            const isLast = idx === includedNodes.length - 1;
            const moveEarlier = getMoveResult(n.nodeId, -1);
            const moveLater = getMoveResult(n.nodeId, 1);

            return (
              <div
                key={n.nodeId}
                role="listitem"
                tabIndex={0}
                onContextMenu={(event) => contextMenu.openMenu(event, buildTopicMenuItems(n, true))}
                onClick={() => onSelectNode(n.nodeId)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onSelectNode(n.nodeId);
                  }
                }}
                className={`group flex items-center justify-between p-3 rounded-xl text-xs transition-all cursor-pointer select-none border ${
                  isSelected
                    ? 'bg-primary-500/10 border-primary-500/40 shadow-sm'
                    : 'bg-surface-50 dark:bg-surface-800/60 border-surface-200 dark:border-surface-700/80 hover:border-surface-300 dark:hover:border-surface-600'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  <span className="w-6 text-center font-bold text-surface-400 font-mono">
                    {idx + 1}
                  </span>
                  <div>{renderActivityIcon(activity)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-surface-900 dark:text-surface-100 truncate">
                        {n.title}
                      </span>
                      {n.locked && (
                        <span title={translateRecentFeature("studyPlans.ui.locked.784cd9a0")}>
                          <Lock size={12} weight="fill" className="text-amber-500" />
                        </span>
                      )}
                      <span className="text-[10px] text-surface-400 font-medium">{translateRecentFeature("studyPlans.ui.var0-obj.2bd755bf", {var0: n.learningObjectives.length})}</span>
                    </div>
                  </div>
                </div>

                {!isReadOnly && (
                  <div
                    className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={isFirst || !moveEarlier.ok}
                      onClick={() => handleMove(n.nodeId, -1)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={moveEarlier.ok ? translateRecentFeature("studyPlans.ui.move-earlier-up.15fc9147") : moveEarlier.reason}
                      aria-label={translateRecentFeature("studyPlans.ui.move-var0-earlier.10d80193", {var0: n.title})}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={isLast || !moveLater.ok}
                      onClick={() => handleMove(n.nodeId, 1)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title={moveLater.ok ? translateRecentFeature("studyPlans.ui.move-later-down.7d2ed06b") : moveLater.reason}
                      aria-label={translateRecentFeature("studyPlans.ui.move-var0-later.2688aa0f", {var0: n.title})}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add Topic button */}
      {!isReadOnly && nodes.length < 100 && (
        <Button
          variant="tonal"
          size="sm"
          onClick={handleAddTopic}
        >
          <Plus size={16} />
          <span>{translateRecentFeature("studyPlans.ui.add-topic.00de0b4e")}</span>
        </Button>
      )}

      {/* Removed Topics (Tombstones) */}
      {tombstoneNodes.length > 0 && (
        <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
          <h4 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">{translateRecentFeature("studyPlans.ui.removed-topics-var0.49d8cbed", {var0: tombstoneNodes.length})}</h4>
          <div className="space-y-1.5">
            {tombstoneNodes.map((n) => {
                            return (
              <div
                key={n.nodeId}
                tabIndex={0}
                onContextMenu={(event) => contextMenu.openMenu(event, buildTopicMenuItems(n, false))}
                className="flex items-center justify-between p-2.5 rounded-xl bg-surface-100 dark:bg-surface-800 text-xs text-surface-500 border border-surface-200 dark:border-surface-700"
              >
                <span className="line-through truncate pr-2">{n.title}</span>
                {!isReadOnly && (
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => handleRestoreTombstone(n.nodeId)}
                  >
                    <ArrowCounterClockwise size={14} className="text-emerald-500" />
                    <span>{translateRecentFeature("mainLayout.restore")}</span>
                  </Button>
                )}
              </div>
            );
            })}
          </div>
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
