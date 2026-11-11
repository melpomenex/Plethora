/**
 * Curriculum Draft Preview & Acceptance Component.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T09)
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  GitDiff,
  ListNumbers,
  Trash,
  PencilSimple,
  Lock,
  GitFork,
  Link,
  ShieldCheck,
  SpinnerGap,
  Sparkle,
} from '@phosphor-icons/react';
import { Button } from '../md3/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { PlanVersionDiff } from './PlanVersionDiff';
import { GenerationIssueList } from './GenerationIssueList';
import { RulesOnlyNotice } from './RulesOnlyNotice';
import type { StudyPlanDetail } from '../../types/learningPaths';
import type { MergeCurriculumResult } from '../../lib/study-plans/generation/merge';

export interface CurriculumDraftPreviewProps {
  planDetail: StudyPlanDetail;
  mergeResult?: MergeCurriculumResult | null;
  isRulesOnly?: boolean;
  onAccept: () => Promise<void> | void;
  onDiscard: () => Promise<void> | void;
  onEditInEditor?: () => void;
  isAccepting?: boolean;
  isDiscarding?: boolean;
  error?: string | null;
  /** C7-T03 optional diagnostic host slot. */
  diagnosticSlot?: React.ReactNode;
}

type PreviewTab = 'outline' | 'diff';

export const CurriculumDraftPreview: React.FC<CurriculumDraftPreviewProps> = ({
  planDetail,
  mergeResult,
  isRulesOnly = false,
  onAccept,
  onDiscard,
  onEditInEditor,
  isAccepting = false,
  isDiscarding = false,
  error = null,
  diagnosticSlot,
}) => {
  const [activeTab, setActiveTab] = useState<PreviewTab>('outline');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [lockConflictsAcknowledged, setLockConflictsAcknowledged] = useState(false);

  const nodes = planDetail.version.nodes.filter((n) => n.included);
  const prerequisites = planDetail.version.prerequisites;
  const diff = mergeResult?.diff ?? null;
  const droppedEdgesCount = mergeResult?.droppedEdgesCount ?? 0;

  const unsupportedCount = nodes.filter((n) => n.materialSupport === 'unsupported').length;
  const lockedCount = nodes.filter((n) => n.locked).length;

  const handleConfirmDiscard = async () => {
    setShowDiscardConfirm(false);
    await onDiscard();
  };

  const hasLockConflicts = (diff?.lockConflicts?.length ?? 0) > 0;
  const canAccept = !hasLockConflicts || lockConflictsAcknowledged;

  return (
    <div
      aria-label="Curriculum draft preview container"
      className="max-w-5xl mx-auto p-6 space-y-6"
    >
      {diagnosticSlot}
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary-500/30 text-primary-600 dark:text-primary-400 bg-primary-500/10">
              Draft Preview v{planDetail.version.version}
            </span>
            {isRulesOnly ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/10 flex items-center gap-1">
                <ShieldCheck size={12} />
                <span>Deterministic Outline</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10 flex items-center gap-1">
                <Sparkle size={12} />
                <span>AI-Generated</span>
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 capitalize">
              {planDetail.plan.depth} Depth
            </span>
          </div>

          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
            {planDetail.plan.title}
          </h1>
          <p className="text-xs text-surface-500 line-clamp-1">{planDetail.plan.goal}</p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
          <Button
            variant="text"
            size="sm"
            onClick={() => setShowDiscardConfirm(true)}
            disabled={isDiscarding || isAccepting}
            aria-label="Discard generated draft"
          >
            <Trash size={16} />
            <span>Discard</span>
          </Button>

          {onEditInEditor && (
            <Button
              variant="tonal"
              size="sm"
              onClick={onEditInEditor}
              disabled={isAccepting || isDiscarding}
              aria-label="Open in full editor"
            >
              <PencilSimple size={16} />
              <span>Edit in Editor</span>
            </Button>
          )}

          <Button
            variant="filled"
            size="sm"
            onClick={onAccept}
            disabled={!canAccept || isAccepting || isDiscarding}
            aria-label="Accept and publish curriculum draft"
          >
            {isAccepting ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            <span>{isAccepting ? 'Publishing…' : 'Accept & Publish'}</span>
          </Button>
        </div>
      </div>

      {/* Rules Only Notice if applicable */}
      {isRulesOnly && (
        <RulesOnlyNotice
          conceptCount={nodes.filter((n) => Boolean(n.conceptId)).length}
          edgeCount={prerequisites.length}
          sourceCount={Object.keys(planDetail.sourceRefs).length}
        />
      )}

      {/* Issues list if any */}
      <GenerationIssueList
        generalError={error}
        droppedCycleEdgesCount={droppedEdgesCount}
        unsupportedNodeCount={unsupportedCount}
      />

      {/* Summary Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            Total Topics
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {nodes.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            Prerequisite Links
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {prerequisites.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            Grounded Material
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {nodes.length - unsupportedCount} / {nodes.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            Preserved Locks
          </div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {lockedCount}
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div
        role="tablist"
        aria-label="Preview tabs"
        className="flex items-center gap-1 border-b border-surface-200 dark:border-surface-700 text-xs font-semibold"
      >
        <button
          role="tab"
          aria-selected={activeTab === 'outline'}
          onClick={() => setActiveTab('outline')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'outline'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <ListNumbers size={16} />
          <span>Curriculum Outline ({nodes.length})</span>
        </button>

        {diff && (
          <button
            role="tab"
            aria-selected={activeTab === 'diff'}
            onClick={() => setActiveTab('diff')}
            className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
              activeTab === 'diff'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
            }`}
          >
            <GitDiff size={16} />
            <span>Version Diff</span>
          </button>
        )}
      </div>

      {/* Tab Panels */}
      {activeTab === 'outline' && (
        <div className="space-y-4">
          <div className="space-y-3">
            {nodes.map((node, index) => {
              // Prerequisite nodes
              const nodePrereqs = prerequisites
                .filter((p) => p.dependentNodeId === node.nodeId)
                .map((p) => nodes.find((n) => n.nodeId === p.prerequisiteNodeId))
                .filter(Boolean);

              return (
                <div
                  key={node.nodeId}
                  className="p-4 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/60 space-y-2.5 text-xs transition-shadow hover:shadow-sm"
                >
                  {/* Title & Index Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold flex items-center justify-center text-xs">
                        {index + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100">
                            {node.title}
                          </h3>
                          {node.locked && (
                            <span
                              title="Locked position"
                              className="text-amber-500 flex items-center gap-0.5 text-[11px] font-semibold"
                            >
                              <Lock size={12} weight="fill" />
                              <span>Locked</span>
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              node.materialSupport === 'grounded'
                                ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                                : 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                            }`}
                          >
                            {node.materialSupport}
                          </span>
                        </div>
                        {node.conceptLabel && (
                          <div className="text-[11px] text-surface-500">
                            Concept: <span className="font-semibold">{node.conceptLabel}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  {node.summary && (
                    <p className="text-surface-600 dark:text-surface-300 text-[11px] leading-relaxed pl-8">
                      {node.summary}
                    </p>
                  )}

                  {/* Learning Objectives */}
                  {node.learningObjectives.length > 0 && (
                    <div className="pl-8 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-surface-400">
                        Learning Objectives
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-surface-700 dark:text-surface-300">
                        {node.learningObjectives.map((obj, i) => (
                          <li key={i}>{obj}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Grounded Source Citations & Prereqs */}
                  <div className="pl-8 flex items-center gap-2 flex-wrap pt-1 text-[11px]">
                    {node.sourceRefIds.length > 0 && (
                      <div className="flex items-center gap-1 text-surface-500">
                        <Link size={13} />
                        <span>{node.sourceRefIds.length} source reference(s)</span>
                      </div>
                    )}

                    {nodePrereqs.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <GitFork size={13} className="text-primary-500" />
                        <span className="text-surface-500">Prerequisites:</span>
                        {nodePrereqs.map((p) => (
                          <span
                            key={p!.nodeId}
                            className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 font-semibold text-[10px]"
                          >
                            {p!.title}
                          </span>
                        ))}
                      </div>
                    )}

                    {node.whyHere && (
                      <div className="text-[10px] text-surface-400 italic">
                        Proposal note: {node.whyHere}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'diff' && (
        <PlanVersionDiff
          diff={diff}
          onAcknowledgeLockConflicts={() =>
            setLockConflictsAcknowledged(!lockConflictsAcknowledged)
          }
          lockConflictsAcknowledged={lockConflictsAcknowledged}
        />
      )}

      {/* Discard confirmation dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard Generated Draft?"
        message="Are you sure you want to discard this generated curriculum draft? All unaccepted topics and prerequisite proposals will be permanently removed."
        confirmLabel="Discard Draft"
        cancelLabel="Keep Reviewing"
        variant="danger"
      />
    </div>
  );
};
