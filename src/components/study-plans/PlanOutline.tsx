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
  Plus,
  ArrowCounterClockwise,
  Warning,
  CheckCircle,
  Circle,
  PlayCircle,
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

export interface PlanOutlineProps {
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  selectedNodeId: string | null;
  activityByNodeId?: Record<string, NodeActivity>;
  onSelectNode: (nodeId: string) => void;
  onChangeNodes: (updatedNodes: StudyPlanVersionNode[]) => void;
  isReadOnly?: boolean;
}

export const PlanOutline: React.FC<PlanOutlineProps> = ({
  nodes,
  prerequisites,
  selectedNodeId,
  activityByNodeId = {},
  onSelectNode,
  onChangeNodes,
  isReadOnly = false,
}) => {
  const [orderConflict, setOrderConflict] = useState<string | null>(null);

  const includedNodes = nodes
    .filter((n) => n.included)
    .sort((a, b) => a.position - b.position);

  const tombstoneNodes = nodes.filter((n) => !n.included);

  const handleMove = (nodeId: string, delta: number) => {
    if (isReadOnly) return;
    setOrderConflict(null);

    const node = includedNodes.find((n) => n.nodeId === nodeId);
    if (!node) return;

    const targetPos = node.position + delta;
    const reorderResult = reorderStudyPlanNode(nodes, prerequisites, nodeId, targetPos);

    if (!reorderResult.ok) {
      if (reorderResult.error.code === 'order_conflict') {
        const minP = (reorderResult.error.details?.minPosition ?? 0) + 1;
        const maxP = (reorderResult.error.details?.maxPosition ?? includedNodes.length - 1) + 1;
        setOrderConflict(
          `Cannot move "${node.title}" to position ${targetPos + 1}. Use positions ${minP}–${maxP} so prerequisites remain first.`
        );
      } else {
        setOrderConflict(reorderResult.error.messageKey);
      }
      return;
    }

    onChangeNodes(reorderResult.value);
  };

  const handleAddTopic = () => {
    if (isReadOnly || nodes.length >= 100) return;
    setOrderConflict(null);

    const newId = `spn_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPosition = includedNodes.length;

    const newNode: StudyPlanVersionNode = {
      nodeId: newId,
      title: `Topic ${newPosition + 1}`,
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
          <span title="Completed">
            <CheckCircle size={15} weight="fill" className="text-emerald-500" />
          </span>
        );
      case 'in-progress':
        return (
          <span title="In progress">
            <PlayCircle size={15} className="text-blue-500" />
          </span>
        );
      case 'skipped':
        return (
          <span title="Skipped">
            <Prohibit size={15} className="text-amber-500" />
          </span>
        );
      default:
        return (
          <span title="Not started">
            <Circle size={15} className="text-surface-400" />
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
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
            Dismiss
          </button>
        </div>
      )}

      {/* Included ordered list */}
      <div
        role="list"
        aria-label="Ordered study plan topics"
        className="space-y-2"
      >
        {includedNodes.length === 0 ? (
          <div className="py-8 text-center text-xs text-surface-500 border border-dashed border-surface-200 dark:border-surface-700 rounded-2xl">
            No active topics in this plan.
          </div>
        ) : (
          includedNodes.map((n, idx) => {
            const isSelected = selectedNodeId === n.nodeId;
            const activity = activityByNodeId[n.nodeId] || 'not-started';
            const isFirst = idx === 0;
            const isLast = idx === includedNodes.length - 1;

            return (
              <div
                key={n.nodeId}
                role="listitem"
                tabIndex={0}
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
                        <span title="Locked">
                          <Lock size={12} weight="fill" className="text-amber-500" />
                        </span>
                      )}
                      <span className="text-[10px] text-surface-400 font-medium">
                        {n.learningObjectives.length} obj
                      </span>
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
                      disabled={isFirst}
                      onClick={() => handleMove(n.nodeId, -1)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move earlier (Up)"
                      aria-label={`Move ${n.title} earlier`}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => handleMove(n.nodeId, 1)}
                      className="p-1.5 rounded-lg text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Move later (Down)"
                      aria-label={`Move ${n.title} later`}
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
          <span>Add Topic</span>
        </Button>
      )}

      {/* Removed Topics (Tombstones) */}
      {tombstoneNodes.length > 0 && (
        <div className="pt-4 border-t border-surface-200 dark:border-surface-700">
          <h4 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-2">
            Removed Topics ({tombstoneNodes.length})
          </h4>
          <div className="space-y-1.5">
            {tombstoneNodes.map((n) => (
              <div
                key={n.nodeId}
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
                    <span>Restore</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
