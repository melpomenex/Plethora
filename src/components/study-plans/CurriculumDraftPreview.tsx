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
import type { StudyPlanDetail, StudyPlanVersionNode } from '../../types/learningPaths';
import type { MergeCurriculumResult } from '../../lib/study-plans/generation/merge';
import { t as translateRecentFeature, useI18n } from "../../lib/i18n";


export interface CurriculumDraftPreviewProps {
  planDetail: StudyPlanDetail;
  mergeResult?: MergeCurriculumResult | null;
  isRulesOnly?: boolean;
  onAccept: () => Promise<void> | void;
  onDiscard: () => Promise<void> | void;
  onEditInEditor?: () => void;
  /** Opens a saved source reference for exact navigation. */
  onOpenSource?: (refId: string) => void;
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
  onOpenSource,
  isAccepting = false,
  isDiscarding = false,
  error = null,
  diagnosticSlot,
}) => {
        useI18n();
        const [activeTab, setActiveTab] = useState<PreviewTab>('outline');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [lockConflictsAcknowledged, setLockConflictsAcknowledged] = useState(false);

  const nodes = planDetail.version.nodes.filter((n) => n.included);
  const prerequisites = planDetail.version.prerequisites;
  const diff = mergeResult?.diff ?? null;
  const droppedEdgesCount = mergeResult?.droppedEdgesCount ?? 0;

  const unsupportedCount = nodes.filter((n) => n.materialSupport === 'unsupported').length;
  const lockedCount = nodes.filter((n) => n.locked).length;

  const authority = planDetail.version.knowledgeAuthority;
  const authorityLabel = authority.kind === 'model-only'
    ? translateRecentFeature("studyPlans.ui.ai-knowledge-only.c613843f")
    : authority.kind === 'manual'
      ? translateRecentFeature("studyPlans.ui.manual.5eefa28f")
      : authority.policy === 'source-plus-model-knowledge'
        ? translateRecentFeature("studyPlans.ui.library-ai-knowledge.f5ace319")
        : translateRecentFeature("studyPlans.ui.library-only.3ec89751");

  /** Claim-level attribution for a topic's material support. */
  function materialSupportLabel(support: StudyPlanVersionNode['materialSupport']): string {
    if (support === 'grounded') return 'Verified library evidence';
    if (support === 'unsupported') {
      return authority.kind === 'model-only' ? 'Unverified model output' : 'AI supplement · unverified';
    }
    return 'Not validated';
  }

  function prerequisiteSupportLabel(support: string): string {
    if (support === 'confirmed-concept-link') return 'Confirmed link';
    if (support === 'inferred') return 'Inferred';
    if (support === 'unsupported') return 'Unsupported';
    return support;
  }

  const handleConfirmDiscard = async () => {
    setShowDiscardConfirm(false);
    await onDiscard();
  };

  const hasLockConflicts = (diff?.lockConflicts?.length ?? 0) > 0;
  const canAccept = !hasLockConflicts || lockConflictsAcknowledged;

  return (
    <div
      aria-label={translateRecentFeature("studyPlans.ui.curriculum-draft-preview-con.a22e5813")}
      className="max-w-5xl mx-auto p-6 space-y-6"
    >
      {diagnosticSlot}
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary-500/30 text-primary-600 dark:text-primary-400 bg-primary-500/10">{translateRecentFeature("studyPlans.ui.draft-preview-v-var0.89eabe22", {var0: planDetail.version.version})}</span>
            {isRulesOnly ? (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-600 dark:text-blue-400 bg-blue-500/10 flex items-center gap-1">
                <ShieldCheck size={12} />
                <span>{translateRecentFeature("studyPlans.ui.deterministic-outline.2395a52d")}</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-500/10 flex items-center gap-1">
                <Sparkle size={12} />
                <span>{translateRecentFeature("studyPlans.ui.ai-generated.8c7ee24e")}</span>
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 capitalize">
              {authorityLabel}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 capitalize">{translateRecentFeature("studyPlans.ui.var0-depth.8ada55a6", {var0: planDetail.plan.depth})}</span>
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
            aria-label={translateRecentFeature("studyPlans.ui.discard-generated-draft.3bd7cb13")}
          >
            <Trash size={16} />
            <span>{translateRecentFeature("screenshot.discard")}</span>
          </Button>

          {onEditInEditor && (
            <Button
              variant="tonal"
              size="sm"
              onClick={onEditInEditor}
              disabled={isAccepting || isDiscarding}
              aria-label={translateRecentFeature("studyPlans.ui.open-in-full-editor.8db34f08")}
            >
              <PencilSimple size={16} />
              <span>{translateRecentFeature("studyPlans.ui.edit-in-editor.b7bc1bf5")}</span>
            </Button>
          )}

          <Button
            variant="filled"
            size="sm"
            onClick={onAccept}
            disabled={!canAccept || isAccepting || isDiscarding}
            aria-label={translateRecentFeature("studyPlans.ui.accept-and-publish-curriculu.45fcfdfb")}
          >
            {isAccepting ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            <span>{isAccepting ? translateRecentFeature("studyPlans.ui.publishing.3ef5cb82") : translateRecentFeature("studyPlans.ui.accept-publish.a111f0cb")}</span>
          </Button>
        </div>
      </div>

      {/* Rules Only Notice if applicable */}
      {isRulesOnly && (
        <RulesOnlyNotice
          conceptCount={nodes.filter((n) => Boolean(n.conceptId)).length}
          edgeCount={prerequisites.filter((edge) => edge.support === 'confirmed-concept-link').length}
          sourceCount={planDetail.version.sourceScope?.resolvedDocuments.length ?? 0}
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
            {translateRecentFeature("studyPlans.ui.total-topics.950920e0")}</div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {nodes.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            {translateRecentFeature("studyPlans.ui.prerequisite-links.364c1470")}</div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {prerequisites.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            {translateRecentFeature("studyPlans.ui.grounded-material.3604c1d5")}</div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {nodes.length - unsupportedCount} / {nodes.length}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          <div className="text-[10px] font-bold uppercase tracking-wider text-surface-500 mb-0.5">
            {translateRecentFeature("studyPlans.ui.preserved-locks.f7afefbe")}</div>
          <div className="text-lg font-bold text-surface-900 dark:text-surface-100">
            {lockedCount}
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div
        role="tablist"
        aria-label={translateRecentFeature("studyPlans.ui.preview-tabs.aa75360e")}
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
          <span>{translateRecentFeature("studyPlans.ui.curriculum-outline-var0.e2fb96e7", {var0: nodes.length})}</span>
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
            <span>{translateRecentFeature("studyPlans.ui.version-diff.4b3d2659")}</span>
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
                  className="p-4 rounded-xl border border-outline-variant bg-surface-container text-on-surface space-y-2.5 text-xs transition-shadow hover:shadow-sm"
                >
                  {/* Title & Index Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold flex items-center justify-center text-xs">
                        {index + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-on-surface">
                            {node.title}
                          </h3>
                          {node.locked && (
                            <span
                              title={translateRecentFeature("studyPlans.ui.locked-position.d1d3ebd9")}
                              className="text-amber-500 flex items-center gap-0.5 text-[11px] font-semibold"
                            >
                              <Lock size={12} weight="fill" />
                              <span>{translateRecentFeature("studyPlans.ui.locked.784cd9a0")}</span>
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                              node.materialSupport === 'grounded'
                                ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                                : 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                            }`}
                            title={materialSupportLabel(node.materialSupport)}
                          >
                            {materialSupportLabel(node.materialSupport)}
                          </span>
                        </div>
                        {node.conceptLabel && (
                          <div className="text-[11px] text-on-surface-variant">
                            {translateRecentFeature("studyPlans.ui.concept.5b44e87e")}<span className="font-semibold">{node.conceptLabel}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  {node.summary && (
                    <p className="text-on-surface-variant text-[11px] leading-relaxed pl-8">
                      {node.summary}
                    </p>
                  )}

                  {/* Learning Objectives */}
                  {node.learningObjectives.length > 0 && (
                    <div className="pl-8 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                        {translateRecentFeature("studyPlans.ui.learning-objectives.998ffd65")}</div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-on-surface-variant">
                        {node.learningObjectives.map((obj, i) => (
                          <li key={i}>{obj}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Grounded Source Citations & Prereqs */}
                  <div className="pl-8 flex items-center gap-2 flex-wrap pt-1 text-[11px]">
                    {node.sourceRefIds.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap text-on-surface-variant">
                        <Link size={13} />
                        <span>{translateRecentFeature("studyPlans.ui.var0-source-reference-s.22b762ba", {var0: node.sourceRefIds.length})}</span>
                        {node.sourceRefIds.map((refId) => {
                          const resolution = planDetail.sourceRefs?.[refId];
                          const status = resolution?.status ?? 'missing';
                          const exactNav = resolution?.navigation === 'exact';
                          return (
                            <button
                              key={refId}
                              type="button"
                              onClick={() => onOpenSource?.(refId)}
                              disabled={!onOpenSource}
                              title={exactNav ? translateRecentFeature("studyPlans.ui.open-exact-source-location.faf64705") : translateRecentFeature("studyPlans.ui.open-source-coarse.f7abdecb")}
                              className={`px-1.5 py-0.5 rounded font-semibold text-[10px] border disabled:opacity-60 ${
                                status === 'current'
                                  ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                                  : 'border-amber-500/30 text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20'
                              }`}
                            >
                              {status === 'current' ? (exactNav ? translateRecentFeature("studyPlans.ui.exact.71c7d433") : translateRecentFeature("mainLayout.open")) : status}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {nodePrereqs.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <GitFork size={13} className="text-primary-500" />
                          <span className="text-on-surface-variant">{translateRecentFeature("studyPlans.ui.prerequisites.2324f297")}</span>
                        {nodePrereqs.map((p, _i) => {
                          const edge = prerequisites.find(
                            (candidate) => candidate.dependentNodeId === node.nodeId &&
                              candidate.prerequisiteNodeId === p!.nodeId
                          );
                          return (
                            <span
                              key={p!.nodeId}
                              className="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-semibold text-[10px]"
                            >
                              {p!.title}
                              {edge && edge.support !== 'user' && (
                                <span
                                  className={`ml-1 rounded px-1 text-[9px] uppercase tracking-wide font-bold ${
                                    edge.support === 'unsupported'
                                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                      : 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
                                  }`}
                                >
                                  {prerequisiteSupportLabel(edge.support)}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {node.whyHere && (
                      <div className="text-[10px] text-on-surface-variant italic">{translateRecentFeature("studyPlans.ui.proposal-note-var0.4b58ec3b", {var0: node.whyHere})}</div>
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
        title={translateRecentFeature("studyPlans.ui.discard-generated-draft.fdb298dc")}
        message={translateRecentFeature("studyPlans.ui.are-you-sure-you-want-to-dis.5bc76627")}
        confirmLabel={translateRecentFeature("studyPlans.ui.discard-draft.539f3389")}
        cancelLabel={translateRecentFeature("studyPlans.ui.keep-reviewing.20727b5d")}
        variant="danger"
      />
    </div>
  );
};
