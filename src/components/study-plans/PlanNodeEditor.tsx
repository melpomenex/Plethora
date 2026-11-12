/**
 * Plan Node Editor component for editing individual topic properties.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React, { useState } from 'react';
import {
  Lock,
  LockOpen,
  Trash,
  ArrowCounterClockwise,
  Plus,
  Minus,
} from '@phosphor-icons/react';
import type {
  StudyPlanVersionNode,
  PlanPrerequisite,
  NodeActivity,
} from '../../types/learningPaths';
import type { StudySourceResolution } from '../../types/studySource';
import { NodeActivityControl } from './NodeActivityControl';
import { PrerequisiteEditor } from './PrerequisiteEditor';
import { PlanSourceList } from './PlanSourceList';
import { Button } from '../md3/Button';

export interface PlanNodeEditorProps {
  node: StudyPlanVersionNode;
  allNodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  activity: NodeActivity;
  sourceResolutions?: Record<string, StudySourceResolution>;
  onChangeNode: (updatedNode: StudyPlanVersionNode) => void;
  onChangePrerequisites: (updatedPrerequisites: PlanPrerequisite[]) => void;
  onChangeActivity: (newActivity: NodeActivity) => void;
  onOpenSource?: (sourceRefId: string, resolution?: StudySourceResolution) => void;
  isReadOnly?: boolean;
}

export const PlanNodeEditor: React.FC<PlanNodeEditorProps> = ({
  node,
  allNodes,
  prerequisites,
  activity,
  sourceResolutions = {},
  onChangeNode,
  onChangePrerequisites,
  onChangeActivity,
  onOpenSource,
  isReadOnly = false,
}) => {
  const [newObjective, setNewObjective] = useState('');

  const handleUpdate = (patch: Partial<StudyPlanVersionNode>) => {
    if (isReadOnly) return;
    onChangeNode({
      ...node,
      ...patch,
      userModified: true,
    });
  };

  const handleAddObjective = () => {
    const trimmed = newObjective.trim();
    if (!trimmed || node.learningObjectives.length >= 6) return;
    handleUpdate({
      learningObjectives: [...node.learningObjectives, trimmed.slice(0, 240)],
    });
    setNewObjective('');
  };

  const handleRemoveObjective = (index: number) => {
    if (node.learningObjectives.length <= 1) return; // At least 1 objective required
    handleUpdate({
      learningObjectives: node.learningObjectives.filter((_, i) => i !== index),
    });
  };

  const handleEditObjective = (index: number, value: string) => {
    const updated = [...node.learningObjectives];
    updated[index] = value.slice(0, 240);
    handleUpdate({ learningObjectives: updated });
  };

  const handleRemoveSource = (sourceRefId: string) => {
    handleUpdate({
      sourceRefIds: node.sourceRefIds.filter((id) => id !== sourceRefId),
    });
  };

  return (
    <div className="space-y-6 p-6 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700/80">
      {/* Header with Title and Lock / Tombstone badges */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 border border-primary-500/20">
              {node.included ? `Topic #${node.position + 1}` : 'Removed Topic'}
            </span>
            <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
              {node.materialSupport}
            </span>
          </div>

          <label htmlFor="node-title" className="sr-only">
            Topic Title
          </label>
          <input
            id="node-title"
            type="text"
            disabled={isReadOnly}
            value={node.title}
            onChange={(e) => handleUpdate({ title: e.target.value.slice(0, 160) })}
            maxLength={160}
            className="w-full text-lg font-bold bg-transparent text-surface-900 dark:text-surface-100 border-b border-transparent hover:border-surface-300 dark:hover:border-surface-600 focus:border-primary-500 focus:outline-none transition-colors"
            placeholder="Topic title"
          />
        </div>

        {/* Lock and Included toggles */}
        {!isReadOnly && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant={node.locked ? 'filled' : 'tonal'}
              size="sm"
              onClick={() => handleUpdate({ locked: !node.locked })}
              title={node.locked ? 'Topic is locked to position' : 'Click to lock topic'}
            >
              {node.locked ? <Lock size={15} weight="fill" /> : <LockOpen size={15} />}
              <span>{node.locked ? 'Locked' : 'Lock'}</span>
            </Button>

            <Button
              variant="tonal"
              size="sm"
              onClick={() => handleUpdate({ included: !node.included })}
              title={node.included ? 'Remove topic (keep tombstone)' : 'Restore topic'}
            >
              {node.included ? (
                <Trash size={15} className="text-red-500" />
              ) : (
                <ArrowCounterClockwise size={15} className="text-emerald-500" />
              )}
              <span>{node.included ? 'Remove' : 'Restore'}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Activity Status */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
          Study Progress
        </label>
        <div>
          <NodeActivityControl
            activity={activity}
            onChange={onChangeActivity}
          />
        </div>
        <p className="text-[11px] text-surface-500 dark:text-surface-400">
          Open a linked source to study, then mark this topic complete when you’re done.
        </p>
      </div>

      {/* Concept Label */}
      <div className="space-y-1.5">
        <label htmlFor="concept-label" className="text-xs font-bold text-surface-700 dark:text-surface-300">
          Concept / Subject Area
        </label>
        <input
          id="concept-label"
          type="text"
          disabled={isReadOnly}
          value={node.conceptLabel}
          onChange={(e) => handleUpdate({ conceptLabel: e.target.value.slice(0, 120) })}
          placeholder="e.g. Number Theory"
          className="w-full px-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Summary */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="node-summary" className="text-xs font-bold text-surface-700 dark:text-surface-300">
            Topic Summary
          </label>
          <span className="text-[11px] text-surface-400">{node.summary.length} / 1000</span>
        </div>
        <textarea
          id="node-summary"
          disabled={isReadOnly}
          value={node.summary}
          onChange={(e) => handleUpdate({ summary: e.target.value.slice(0, 1000) })}
          rows={3}
          placeholder="Brief summary or description of this study topic…"
          className="w-full px-3 py-2 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      </div>

      {/* Learning Objectives */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
            Learning Objectives ({node.learningObjectives.length} / 6)
          </label>
          <span className="text-[11px] text-surface-400">At least 1 required</span>
        </div>

        <div className="space-y-2">
          {node.learningObjectives.map((obj, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs font-bold text-surface-400 w-4 text-right">
                {i + 1}.
              </span>
              <input
                type="text"
                disabled={isReadOnly}
                value={obj}
                onChange={(e) => handleEditObjective(i, e.target.value)}
                maxLength={240}
                className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {!isReadOnly && node.learningObjectives.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveObjective(i)}
                  className="p-1 text-surface-400 hover:text-red-500 transition-colors"
                  aria-label={`Remove objective ${i + 1}`}
                >
                  <Minus size={15} />
                </button>
              )}
            </div>
          ))}
        </div>

        {!isReadOnly && node.learningObjectives.length < 6 && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value)}
              placeholder="Add another learning objective…"
              maxLength={240}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddObjective();
                }
              }}
              className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <Button
              variant="tonal"
              size="sm"
              disabled={!newObjective.trim()}
              onClick={handleAddObjective}
            >
              <Plus size={15} />
              <span>Add</span>
            </Button>
          </div>
        )}
      </div>

      {/* Prerequisites Section */}
      <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-700">
        <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
          Prerequisites for this Topic
        </label>
        <PrerequisiteEditor
          currentNodeId={node.nodeId}
          allNodes={allNodes}
          prerequisites={prerequisites}
          onChange={onChangePrerequisites}
          isReadOnly={isReadOnly}
        />
      </div>

      {/* Linked Sources Section */}
      <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-700">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
            Linked Source Material ({node.sourceRefIds.length} / 8)
          </label>
        </div>
        <PlanSourceList
          sourceRefIds={node.sourceRefIds}
          sourceResolutions={sourceResolutions}
          onOpenSource={onOpenSource}
          onRemoveSource={handleRemoveSource}
          isReadOnly={isReadOnly}
        />
      </div>
    </div>
  );
};
