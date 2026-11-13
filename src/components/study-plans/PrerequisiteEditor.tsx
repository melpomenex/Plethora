/**
 * Prerequisite Editor component for viewing and editing DAG dependencies.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React, { useState } from 'react';
import { Plus, Trash, Warning, GitFork } from '@phosphor-icons/react';
import type { PlanPrerequisite, StudyPlanVersionNode } from '../../types/learningPaths';
import { orderStudyPlan } from '../../lib/study-plans/topology';
import { Button } from '../md3/Button';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface PrerequisiteEditorProps {
  currentNodeId: string;
  allNodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  onChange: (prerequisites: PlanPrerequisite[]) => void;
  isReadOnly?: boolean;
}

export const PrerequisiteEditor: React.FC<PrerequisiteEditorProps> = ({
  currentNodeId,
  allNodes,
  prerequisites,
  onChange,
  isReadOnly = false,
}) => {
        useI18n();
        const [selectedPrereqId, setSelectedPrereqId] = useState<string>('');
  const [cycleError, setCycleError] = useState<string | null>(null);

  // Prerequisites where currentNode is the DEPENDENT: prereq -> currentNode
  const incomingPrereqs = prerequisites.filter((p) => p.dependentNodeId === currentNodeId);
  const existingPrereqIds = new Set(incomingPrereqs.map((p) => p.prerequisiteNodeId));

  // Eligible nodes: included nodes other than self and not already a prerequisite
  const eligibleCandidates = allNodes.filter(
    (n) => n.included && n.nodeId !== currentNodeId && !existingPrereqIds.has(n.nodeId)
  );

  const handleAddPrereq = () => {
    if (!selectedPrereqId) return;
    setCycleError(null);

    const newPrereq: PlanPrerequisite = {
      prerequisiteNodeId: selectedPrereqId,
      dependentNodeId: currentNodeId,
      support: 'user',
      rationale: null,
      sourceRefIds: [],
    };

    const updatedPrereqs = [...prerequisites, newPrereq];

    // Validate that the updated edge set does not introduce a cycle
    const testResult = orderStudyPlan(allNodes, updatedPrereqs);
    if (!testResult.ok) {
      if (testResult.error.code === 'dependency_cycle') {
        setCycleError('Cannot add prerequisite: would create a circular dependency cycle.');
        return;
      }
    }

    onChange(updatedPrereqs);
    setSelectedPrereqId('');
  };

  const handleRemovePrereq = (prereqNodeId: string) => {
    setCycleError(null);
    onChange(
      prerequisites.filter(
        (p) => !(p.dependentNodeId === currentNodeId && p.prerequisiteNodeId === prereqNodeId)
      )
    );
  };

  const getNodeTitle = (nodeId: string) => {
    const node = allNodes.find((n) => n.nodeId === nodeId);
    return node ? node.title : `Topic ${nodeId.slice(0, 8)}`;
  };

  return (
    <div className="space-y-3">
      {cycleError && (
        <div
          role="alert"
          className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
        >
          <Warning size={16} className="flex-shrink-0" />
          <span>{cycleError}</span>
        </div>
      )}

      {incomingPrereqs.length === 0 ? (
        <p className="text-xs text-surface-500 italic py-1">
          {translateRecentFeature("studyPlans.ui.no-prerequisite-topics-requi.7df1bdb8")}</p>
      ) : (
        <div className="space-y-1.5">
          {incomingPrereqs.map((p) => {
                        return (
            <div
              key={p.prerequisiteNodeId}
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-100 dark:bg-surface-800 text-xs border border-surface-200 dark:border-surface-700"
            >
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <GitFork size={15} className="text-primary-500 flex-shrink-0" />
                <span className="font-semibold text-surface-800 dark:text-surface-200 truncate">
                  {getNodeTitle(p.prerequisiteNodeId)}
                </span>
                <span className="text-[10px] text-surface-400 font-mono">
                  ({p.support})
                </span>
              </div>

              {!isReadOnly && (
                <Button
                  variant="text"
                  size="iconSm"
                  onClick={() => handleRemovePrereq(p.prerequisiteNodeId)}
                  title={translateRecentFeature("studyPlans.ui.remove-prerequisite.affc06f6")}
                  aria-label={translateRecentFeature("studyPlans.ui.remove-prerequisite.affc06f6")}
                >
                  <Trash size={14} className="text-red-500" />
                </Button>
              )}
            </div>
          );
          })}
        </div>
      )}

      {/* Add Prerequisite control */}
      {!isReadOnly && eligibleCandidates.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select
            value={selectedPrereqId}
            onChange={(e) => {
              setSelectedPrereqId(e.target.value);
              setCycleError(null);
            }}
            className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label={translateRecentFeature("studyPlans.ui.select-prerequisite-topic.c0d089f4")}
          >
            <option value="">{translateRecentFeature("studyPlans.ui.select-a-prerequisite-topic-.4deec3e7")}</option>
            {eligibleCandidates.map((n) => (
              <option key={n.nodeId} value={n.nodeId}>
                {n.title}
              </option>
            ))}
          </select>

          <Button
            variant="tonal"
            size="sm"
            disabled={!selectedPrereqId}
            onClick={handleAddPrereq}
          >
            <Plus size={15} />
            <span>{translateRecentFeature("common.add")}</span>
          </Button>
        </div>
      )}
    </div>
  );
};
