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
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


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
        useI18n();
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
              {node.included ? translateRecentFeature("i18nAudit.ui.topic-var0.971fc321", {var0: node.position + 1}) : translateRecentFeature("studyPlans.ui.removed-topic.37236a73")}
            </span>
            <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">
              {node.materialSupport}
            </span>
          </div>

          <label htmlFor="node-title" className="sr-only">
            {translateRecentFeature("studyPlans.ui.topic-title.3b571cbe")}</label>
          <input
            id="node-title"
            type="text"
            disabled={isReadOnly}
            value={node.title}
            onChange={(e) => handleUpdate({ title: e.target.value.slice(0, 160) })}
            maxLength={160}
            className="w-full text-lg font-bold bg-transparent text-surface-900 dark:text-surface-100 border-b border-transparent hover:border-surface-300 dark:hover:border-surface-600 focus:border-primary-500 focus:outline-none transition-colors"
            placeholder={translateRecentFeature("studyPlans.ui.topic-title.f65aa485")}
          />
        </div>

        {/* Lock and Included toggles */}
        {!isReadOnly && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant={node.locked ? 'filled' : 'tonal'}
              size="sm"
              onClick={() => handleUpdate({ locked: !node.locked })}
              title={node.locked ? translateRecentFeature("studyPlans.ui.topic-is-locked-to-position.099d7108") : translateRecentFeature("studyPlans.ui.click-to-lock-topic.c7639a7d")}
            >
              {node.locked ? <Lock size={15} weight="fill" /> : <LockOpen size={15} />}
              <span>{node.locked ? translateRecentFeature("studyPlans.ui.locked.784cd9a0") : translateRecentFeature("studyPlans.ui.lock.5b494f41")}</span>
            </Button>

            <Button
              variant="tonal"
              size="sm"
              onClick={() => handleUpdate({ included: !node.included })}
              title={node.included ? translateRecentFeature("studyPlans.ui.remove-topic-keep-tombstone.66a3e8ff") : translateRecentFeature("studyPlans.ui.restore-topic.6bef8824")}
            >
              {node.included ? (
                <Trash size={15} className="text-red-500" />
              ) : (
                <ArrowCounterClockwise size={15} className="text-emerald-500" />
              )}
              <span>{node.included ? translateRecentFeature("studyPlans.ui.remove.4a6a64df") : translateRecentFeature("mainLayout.restore")}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Activity Status */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.study-progress.799a4679")}</label>
        <div>
          <NodeActivityControl
            activity={activity}
            onChange={onChangeActivity}
          />
        </div>
        <p className="text-[11px] text-surface-500 dark:text-surface-400">
          {translateRecentFeature("studyPlans.ui.open-a-linked-source-to-stud.5fe1a798")}</p>
      </div>

      {/* Concept Label */}
      <div className="space-y-1.5">
        <label htmlFor="concept-label" className="text-xs font-bold text-surface-700 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.concept-subject-area.0aa5f48b")}</label>
        <input
          id="concept-label"
          type="text"
          disabled={isReadOnly}
          value={node.conceptLabel}
          onChange={(e) => handleUpdate({ conceptLabel: e.target.value.slice(0, 120) })}
          placeholder={translateRecentFeature("studyPlans.ui.e-g-number-theory.4ba83fc3")}
          className="w-full px-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Summary */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="node-summary" className="text-xs font-bold text-surface-700 dark:text-surface-300">
            {translateRecentFeature("studyPlans.ui.topic-summary.ceb230a2")}</label>
          <span className="text-[11px] text-surface-400">{translateRecentFeature("studyPlans.ui.var0-1000.1f6cbe13", {var0: node.summary.length})}</span>
        </div>
        <textarea
          id="node-summary"
          disabled={isReadOnly}
          value={node.summary}
          onChange={(e) => handleUpdate({ summary: e.target.value.slice(0, 1000) })}
          rows={3}
          placeholder={translateRecentFeature("studyPlans.ui.brief-summary-or-description.24f97235")}
          className="w-full px-3 py-2 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
      </div>

      {/* Learning Objectives */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-surface-700 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.learning-objectives-var0-6.60fee0d9", {var0: node.learningObjectives.length})}</label>
          <span className="text-[11px] text-surface-400">{translateRecentFeature("studyPlans.ui.at-least-1-required.320c8886")}</span>
        </div>

        <div className="space-y-2">
          {node.learningObjectives.map((obj, i) => {
                        return (
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
                  aria-label={translateRecentFeature("studyPlans.ui.remove-objective-var0.ea7a7edb", {var0: i + 1})}
                >
                  <Minus size={15} />
                </button>
              )}
            </div>
          );
          })}
        </div>

        {!isReadOnly && node.learningObjectives.length < 6 && (
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newObjective}
              onChange={(e) => setNewObjective(e.target.value)}
              placeholder={translateRecentFeature("studyPlans.ui.add-another-learning-objecti.c551965a")}
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
              <span>{translateRecentFeature("common.add")}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Prerequisites Section */}
      <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-700">
        <label className="text-xs font-bold text-surface-700 dark:text-surface-300">
          {translateRecentFeature("studyPlans.ui.prerequisites-for-this-topic.23f9e805")}</label>
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
          <label className="text-xs font-bold text-surface-700 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.linked-source-material-var0-.1ab1cd24", {var0: node.sourceRefIds.length})}</label>
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
