import React, { useState } from 'react';
import {
  ArrowSquareOut,
  BookOpen,
  CheckCircle,
  Circle,
  GitBranch,
  GraduationCap,
  Lock,
  PencilSimple,
  PlayCircle,
  Plus,
  Prohibit,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { NodeActivity, PlanPrerequisite } from '../../../types/learningPaths';
import type { MasteryEvidenceLevel } from '../../../types/learningEvidence';
import type { StudySourceResolution } from '../../../types/studySource';
import type {
  GraphHighlightMode,
  StudyPlanGraphEdge,
  StudyPlanGraphNode,
  StudyPlanSourceGraphNode,
} from '../../../lib/study-plans/graph/types';
import { t, useI18n } from '../../../lib/i18n';
import { NodeActivityControl } from '../NodeActivityControl';
import { getEdgeSupportLabel } from './StudyPlanGraphEdge';
import {
  getActivityStyle,
  getGraphSurfaceTokens,
  getMasteryAccentColor,
  getSourceHealthStyle,
} from './theme';

export interface StudyPlanGraphInspectorProps {
  selectedNode: StudyPlanGraphNode | null;
  selectedSourceNode: StudyPlanSourceGraphNode | null;
  allNodes: StudyPlanGraphNode[];
  nodeById: Readonly<Record<string, StudyPlanGraphNode>>;
  edges: StudyPlanGraphEdge[];
  sourceRefs: Readonly<Record<string, StudySourceResolution>>;
  highlightMode: GraphHighlightMode;
  isReadOnly: boolean;
  onClose: () => void;
  onSelectTopic: (nodeId: string) => void;
  onChangeActivity: (nodeId: string, activity: NodeActivity) => void;
  onOpenEditDrawer: (nodeId: string) => void;
  onStartLesson: (nodeId: string) => void;
  onStartPractice?: (nodeId: string) => void;
  onOpenSource: (refId: string, resolution?: StudySourceResolution) => void;
  onToggleHighlight: (kind: 'prerequisites' | 'dependents', nodeId: string) => void;
  onAddPrerequisite: (prerequisiteNodeId: string, dependentNodeId: string) => void;
  onRemovePrerequisite: (prerequisiteNodeId: string, dependentNodeId: string) => void;
}

function getMasteryLabel(level: MasteryEvidenceLevel | null): string {
  switch (level) {
    case 'demonstrated-consistently':
      return t('studyPlans.graph.masteryConsistent');
    case 'developing':
      return t('studyPlans.graph.masteryDeveloping');
    case 'needs-attention':
      return t('studyPlans.graph.masteryNeedsAttention');
    default:
      return t('studyPlans.graph.masteryInsufficient');
  }
}

function renderMiniActivityIcon(activity: NodeActivity, color: string) {
  switch (activity) {
    case 'completed':
      return <CheckCircle size={13} weight="fill" style={{ color }} aria-hidden="true" />;
    case 'in-progress':
      return <PlayCircle size={13} weight="fill" style={{ color }} aria-hidden="true" />;
    case 'skipped':
      return <Prohibit size={13} weight="bold" style={{ color }} aria-hidden="true" />;
    case 'not-started':
    default:
      return <Circle size={13} style={{ color }} aria-hidden="true" />;
  }
}

export const StudyPlanGraphInspector: React.FC<StudyPlanGraphInspectorProps> = ({
  selectedNode,
  selectedSourceNode,
  allNodes,
  nodeById,
  edges,
  sourceRefs,
  highlightMode,
  isReadOnly,
  onClose,
  onSelectTopic,
  onChangeActivity,
  onOpenEditDrawer,
  onStartLesson,
  onStartPractice,
  onOpenSource,
  onToggleHighlight,
  onAddPrerequisite,
  onRemovePrerequisite,
}) => {
  useI18n();
  const tokens = getGraphSurfaceTokens();
  const [prereqCandidateId, setPrereqCandidateId] = useState('');

  if (!selectedNode && !selectedSourceNode) {
    return null;
  }

  // Source node inspector mode
  if (selectedSourceNode && !selectedNode) {
    const healthStyle = getSourceHealthStyle(selectedSourceNode.status);
    const primaryRefId = selectedSourceNode.refIds[0];
    const primaryResolution = primaryRefId ? sourceRefs[primaryRefId] : undefined;

    return (
      <aside
        data-testid="study-plan-graph-inspector"
        aria-label={t('studyPlans.graph.inspectorAria')}
        className="fixed inset-x-2 bottom-2 max-h-[62vh] z-30 md:inset-x-auto md:right-3 md:top-3 md:bottom-3 md:max-h-none md:w-[340px] lg:static lg:w-[360px] xl:w-[390px] lg:h-full lg:z-auto rounded-2xl border shadow-lg flex flex-col overflow-hidden flex-shrink-0"
        style={{
          backgroundColor: tokens.panelSurface,
          borderColor: tokens.borderSubtle,
          color: tokens.textPrimary,
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-start justify-between gap-2"
          style={{ borderColor: tokens.borderSubtle }}
        >
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: healthStyle.accentColor }}>
              <BookOpen size={13} aria-hidden="true" />
              <span>{t('studyPlans.graph.sourceInspectorTitle')}</span>
            </div>
            <h3 className="text-sm font-bold leading-snug" style={{ color: tokens.textPrimary }}>
              {selectedSourceNode.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('studyPlans.graph.closeInspector')}
            className="p-1.5 rounded-lg hover:opacity-80 cursor-pointer flex-shrink-0"
            style={{ color: tokens.textMuted }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {primaryRefId && (
            <button
              type="button"
              onClick={() => onOpenSource(primaryRefId, primaryResolution)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{
                backgroundColor: tokens.primary,
                color: tokens.onPrimary,
              }}
            >
              <ArrowSquareOut size={14} aria-hidden="true" />
              <span>{t('studyPlans.graph.openFirstSource')}</span>
            </button>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
              {t('studyPlans.graph.sourceSupportsTopics', {
                var0: selectedSourceNode.linkedNodeIds.length,
              })}
            </div>
            <div className="space-y-1.5">
              {selectedSourceNode.linkedNodeIds.map((topicId) => {
                const topic = nodeById[topicId];
                if (!topic) return null;
                const actStyle = getActivityStyle(topic.activity);
                return (
                  <button
                    key={topicId}
                    type="button"
                    onClick={() => onSelectTopic(topicId)}
                    className="w-full text-left px-3 py-2 rounded-xl border flex items-center gap-2 hover:opacity-90 cursor-pointer"
                    style={{
                      backgroundColor: tokens.nodeSurface,
                      borderColor: tokens.borderSubtle,
                    }}
                  >
                    {renderMiniActivityIcon(topic.activity, actStyle.accentColor)}
                    <span className="text-xs font-medium truncate flex-1" style={{ color: tokens.textPrimary }}>
                      {topic.included ? `${topic.curriculumNumber}. ` : ''}
                      {topic.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  if (!selectedNode) {
    return null;
  }

  const displayNumber = selectedNode.included
    ? selectedNode.curriculumNumber
    : selectedNode.position + 1;

  const incomingEdges = edges.filter(
    (edge) => edge.dependentNodeId === selectedNode.nodeId && edge.isValid
  );
  const outgoingEdges = edges.filter(
    (edge) => edge.prerequisiteNodeId === selectedNode.nodeId && edge.isValid
  );

  const directPrereqIdSet = new Set(incomingEdges.map((edge) => edge.prerequisiteNodeId));
  const candidatePrereqNodes = allNodes.filter(
    (n) =>
      n.included &&
      n.nodeId !== selectedNode.nodeId &&
      !directPrereqIdSet.has(n.nodeId)
  );

  const firstResolvableRefId =
    selectedNode.sourceRefIds.find((refId) => sourceRefs[refId]?.status !== 'missing') ??
    selectedNode.sourceRefIds[0];

  const isPrereqPathHighlighted =
    highlightMode.kind === 'prerequisites' && highlightMode.nodeId === selectedNode.nodeId;
  const isDependentsHighlighted =
    highlightMode.kind === 'dependents' && highlightMode.nodeId === selectedNode.nodeId;

  const handleQuickAddPrereq = () => {
    if (!prereqCandidateId) return;
    onAddPrerequisite(prereqCandidateId, selectedNode.nodeId);
    setPrereqCandidateId('');
  };

  return (
    <aside
      data-testid="study-plan-graph-inspector"
      aria-label={t('studyPlans.graph.inspectorAria')}
      className="fixed inset-x-2 bottom-2 max-h-[65vh] z-30 md:inset-x-auto md:right-3 md:top-3 md:bottom-3 md:max-h-none md:w-[340px] lg:static lg:w-[360px] xl:w-[390px] lg:h-full lg:z-auto rounded-2xl border shadow-lg flex flex-col overflow-hidden flex-shrink-0"
      style={{
        backgroundColor: tokens.panelSurface,
        borderColor: tokens.borderSubtle,
        color: tokens.textPrimary,
      }}
    >
      {/* Inspector Header */}
      <div
        className="px-4 py-3 border-b flex items-start justify-between gap-2"
        style={{ borderColor: tokens.borderSubtle }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: tokens.primaryContainer,
                color: tokens.onPrimaryContainer,
              }}
            >
              {t('studyPlans.ui.topic-var0.7b244fd9', { var0: displayNumber })}
            </span>
            {selectedNode.locked && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{
                  backgroundColor: tokens.secondaryContainer,
                  color: tokens.onSecondaryContainer,
                }}
                title={t('studyPlans.graph.authoredLockHint')}
              >
                <Lock size={10} weight="fill" aria-hidden="true" />
                <span>{t('studyPlans.ui.locked.784cd9a0')}</span>
              </span>
            )}
            {selectedNode.conceptLabel && (
              <span
                className="text-[10px] font-medium truncate max-w-[140px]"
                style={{ color: tokens.textMuted }}
              >
                {selectedNode.conceptLabel}
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold leading-snug" style={{ color: tokens.textPrimary }}>
            {selectedNode.title}
          </h3>
        </div>

        <button
          type="button"
          data-testid="study-plan-graph-inspector-close"
          onClick={onClose}
          aria-label={t('studyPlans.graph.closeInspector')}
          className="p-1.5 rounded-lg hover:opacity-80 cursor-pointer flex-shrink-0"
          style={{ color: tokens.textMuted }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="p-4 overflow-y-auto space-y-4 flex-1">
        {/* Primary Action Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="study-plan-graph-inspector-start-lesson"
            onClick={() => onStartLesson(selectedNode.nodeId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer hover:opacity-95"
            style={{
              backgroundColor: tokens.primary,
              color: tokens.onPrimary,
            }}
          >
            <PlayCircle size={14} weight="fill" aria-hidden="true" />
            <span>{t('studyPlans.ui.start-lesson.a198f27f')}</span>
          </button>

          {firstResolvableRefId && (
            <button
              type="button"
              data-testid="study-plan-graph-inspector-open-source"
              onClick={() => onOpenSource(firstResolvableRefId, sourceRefs[firstResolvableRefId])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer hover:opacity-90"
              style={{
                backgroundColor: tokens.nodeSurface,
                borderColor: tokens.borderSubtle,
                color: tokens.textPrimary,
              }}
            >
              <ArrowSquareOut size={13} aria-hidden="true" />
              <span>{t('studyPlans.graph.openFirstSource')}</span>
            </button>
          )}

          <button
            type="button"
            data-testid="study-plan-graph-inspector-edit-topic"
            onClick={() => onOpenEditDrawer(selectedNode.nodeId)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer hover:opacity-90"
            style={{
              backgroundColor: tokens.nodeSurface,
              borderColor: tokens.borderSubtle,
              color: tokens.textPrimary,
            }}
          >
            <PencilSimple size={13} aria-hidden="true" />
            <span>{t('studyPlans.graph.editTopic')}</span>
          </button>

          {onStartPractice && (
            <button
              type="button"
              data-testid="study-plan-graph-inspector-practice"
              onClick={() => onStartPractice(selectedNode.nodeId)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer hover:opacity-90"
              style={{
                backgroundColor: tokens.nodeSurface,
                borderColor: tokens.borderSubtle,
                color: tokens.textPrimary,
              }}
            >
              <GraduationCap size={13} aria-hidden="true" />
              <span>{t('studyPlans.graph.practiceTopic')}</span>
            </button>
          )}
        </div>

        {/* Study Activity Control */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {t('studyPlans.ui.study-progress.799a4679')}
          </div>
          <NodeActivityControl
            activity={selectedNode.activity}
            onChange={(nextActivity) => onChangeActivity(selectedNode.nodeId, nextActivity)}
          />
        </div>

        {/* Evidence & Active Gaps (when hydrated) */}
        {(selectedNode.demonstratedLevel !== null || selectedNode.activeGapCount > 0) && (
          <div
            className="px-3 py-2 rounded-xl border flex items-center justify-between gap-2 text-xs"
            style={{
              backgroundColor: tokens.nodeSurface,
              borderColor: tokens.borderSubtle,
            }}
          >
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tokens.textMuted }}>
                {t('studyPlans.graph.masteryLabel')}
              </div>
              <div
                className="font-semibold"
                style={{ color: getMasteryAccentColor(selectedNode.demonstratedLevel) }}
              >
                {getMasteryLabel(selectedNode.demonstratedLevel)}
              </div>
            </div>
            {selectedNode.activeGapCount > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{
                  backgroundColor: tokens.errorContainer,
                  color: tokens.onErrorContainer,
                }}
              >
                {t('studyPlans.graph.gapCountBadge', { var0: selectedNode.activeGapCount })}
              </span>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {t('studyPlans.graph.summary')}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: tokens.textPrimary }}>
            {selectedNode.summary.trim() || t('studyPlans.graph.noSummary')}
          </p>
        </div>

        {/* Why Here Rationale */}
        {selectedNode.whyHere && (
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
              {t('studyPlans.graph.whyHere')}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: tokens.textMuted }}>
              {selectedNode.whyHere}
            </p>
          </div>
        )}

        {/* Learning Objectives */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {t('studyPlans.graph.learningObjectivesCount', {
              var0: selectedNode.learningObjectives.length,
            })}
          </div>
          <ul className="space-y-1 text-xs">
            {selectedNode.learningObjectives.map((obj, index) => (
              <li key={index} className="flex items-start gap-2 leading-snug">
                <span className="font-bold tabular-nums" style={{ color: tokens.primary }}>
                  {index + 1}.
                </span>
                <span style={{ color: tokens.textPrimary }}>{obj}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Prerequisite Relationships */}
        <div
          className="space-y-2.5 pt-2 border-t"
          style={{ borderColor: tokens.borderSubtle }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {t('studyPlans.graph.prereqRelationships')}
          </div>

          {/* Subgraph Highlight Toggles */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="study-plan-graph-highlight-prereqs"
              aria-pressed={isPrereqPathHighlighted}
              onClick={() => onToggleHighlight('prerequisites', selectedNode.nodeId)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
              style={
                isPrereqPathHighlighted
                  ? {
                      backgroundColor: tokens.primaryContainer,
                      borderColor: tokens.primary,
                      color: tokens.onPrimaryContainer,
                    }
                  : {
                      backgroundColor: tokens.nodeSurface,
                      borderColor: tokens.borderSubtle,
                      color: tokens.textPrimary,
                    }
              }
            >
              <GitBranch size={12} aria-hidden="true" />
              <span>{t('studyPlans.graph.highlightPrereqPath')}</span>
            </button>

            <button
              type="button"
              data-testid="study-plan-graph-highlight-dependents"
              aria-pressed={isDependentsHighlighted}
              onClick={() => onToggleHighlight('dependents', selectedNode.nodeId)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
              style={
                isDependentsHighlighted
                  ? {
                      backgroundColor: tokens.primaryContainer,
                      borderColor: tokens.primary,
                      color: tokens.onPrimaryContainer,
                    }
                  : {
                      backgroundColor: tokens.nodeSurface,
                      borderColor: tokens.borderSubtle,
                      color: tokens.textPrimary,
                    }
              }
            >
              <GitBranch size={12} aria-hidden="true" />
              <span>{t('studyPlans.graph.highlightDependents')}</span>
            </button>
          </div>

          {/* Direct Prerequisites */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold" style={{ color: tokens.textMuted }}>
              {t('studyPlans.graph.requiredByTopic', { var0: incomingEdges.length })}
            </div>
            {incomingEdges.length === 0 ? (
              <div className="text-xs italic" style={{ color: tokens.textMuted }}>
                {t('studyPlans.graph.entryTopicNone')}
              </div>
            ) : (
              <div className="space-y-1">
                {incomingEdges.map((edge) => {
                  const prereqNode = nodeById[edge.prerequisiteNodeId];
                  if (!prereqNode) return null;
                  const actStyle = getActivityStyle(prereqNode.activity);
                  return (
                    <div
                      key={edge.id}
                      className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs"
                      style={{
                        backgroundColor: tokens.nodeSurface,
                        borderColor: tokens.borderSubtle,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTopic(prereqNode.nodeId)}
                        className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer hover:opacity-80"
                      >
                        {renderMiniActivityIcon(prereqNode.activity, actStyle.accentColor)}
                        <span className="truncate font-medium" style={{ color: tokens.textPrimary }}>
                          {prereqNode.included ? `${prereqNode.curriculumNumber}. ` : ''}
                          {prereqNode.title}
                        </span>
                      </button>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{
                          backgroundColor: tokens.secondaryContainer,
                          color: tokens.onSecondaryContainer,
                        }}
                      >
                        {getEdgeSupportLabel(edge.support)}
                      </span>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            onRemovePrerequisite(prereqNode.nodeId, selectedNode.nodeId)
                          }
                          aria-label={t('studyPlans.graph.edgeRemove')}
                          className="p-1 rounded hover:opacity-80 cursor-pointer flex-shrink-0"
                          style={{ color: tokens.errorAccent }}
                        >
                          <Trash size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Quick Inline Add Prerequisite in Draft Mode */}
            {!isReadOnly && candidatePrereqNodes.length > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                <select
                  value={prereqCandidateId}
                  onChange={(e) => setPrereqCandidateId(e.target.value)}
                  aria-label={t('studyPlans.graph.addPrereqAria')}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs outline-none"
                  style={{
                    backgroundColor: tokens.nodeSurface,
                    borderColor: tokens.borderSubtle,
                    color: tokens.textPrimary,
                  }}
                >
                  <option value="">{t('studyPlans.graph.addPrereqPlaceholder')}</option>
                  {candidatePrereqNodes.map((candidate) => (
                    <option key={candidate.nodeId} value={candidate.nodeId}>
                      {candidate.curriculumNumber}. {candidate.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="study-plan-graph-inspector-add-prereq"
                  disabled={!prereqCandidateId}
                  onClick={handleQuickAddPrereq}
                  aria-label={t('studyPlans.graph.addPrereqAria')}
                  className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: tokens.primaryContainer,
                    borderColor: tokens.primary,
                    color: tokens.onPrimaryContainer,
                  }}
                >
                  <Plus size={14} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Direct Dependents */}
          {outgoingEdges.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold" style={{ color: tokens.textMuted }}>
                {t('studyPlans.graph.enablesTopics', { var0: outgoingEdges.length })}
              </div>
              <div className="space-y-1">
                {outgoingEdges.map((edge) => {
                  const depNode = nodeById[edge.dependentNodeId];
                  if (!depNode) return null;
                  const actStyle = getActivityStyle(depNode.activity);
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => onSelectTopic(depNode.nodeId)}
                      className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs text-left cursor-pointer hover:opacity-85"
                      style={{
                        backgroundColor: tokens.nodeSurface,
                        borderColor: tokens.borderSubtle,
                      }}
                    >
                      <span className="flex items-center gap-1.5 min-w-0 flex-1">
                        {renderMiniActivityIcon(depNode.activity, actStyle.accentColor)}
                        <span className="truncate font-medium" style={{ color: tokens.textPrimary }}>
                          {depNode.included ? `${depNode.curriculumNumber}. ` : ''}
                          {depNode.title}
                        </span>
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{
                          backgroundColor: tokens.secondaryContainer,
                          color: tokens.onSecondaryContainer,
                        }}
                      >
                        {getEdgeSupportLabel(edge.support)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Linked Sources */}
        <div
          className="space-y-2 pt-2 border-t"
          style={{ borderColor: tokens.borderSubtle }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tokens.textMuted }}>
            {t('studyPlans.graph.linkedSourcesCount', { var0: selectedNode.sourceRefIds.length })}
          </div>

          {selectedNode.sourceRefIds.length === 0 ? (
            <div className="text-xs italic" style={{ color: tokens.textMuted }}>
              {t('studyPlans.graph.noSourcesBadge')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {selectedNode.sourceRefIds.map((refId) => {
                const resolution = sourceRefs[refId];
                const status = resolution?.status;
                const healthStyle = getSourceHealthStyle(status);
                const docTitle = resolution?.ref?.documentTitle || refId;

                return (
                  <div
                    key={refId}
                    className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-xs"
                    style={{
                      backgroundColor: tokens.nodeSurface,
                      borderColor: healthStyle.hasWarning ? healthStyle.accentColor : tokens.borderSubtle,
                    }}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="font-medium truncate" style={{ color: tokens.textPrimary }}>
                        {docTitle}
                      </div>
                      {healthStyle.hasWarning && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: healthStyle.accentColor }}>
                          <Warning size={11} weight="fill" aria-hidden="true" />
                          <span>
                            {status === 'missing'
                              ? t('studyPlans.graph.missingSourceBadge')
                              : status === 'stale'
                                ? t('studyPlans.graph.staleSourceBadge')
                                : t('studyPlans.graph.ambiguousSourceBadge')}
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenSource(refId, resolution)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer hover:opacity-90 flex-shrink-0"
                      style={{
                        backgroundColor: tokens.panelElevatedSurface,
                        borderColor: tokens.borderSubtle,
                        color: tokens.primary,
                      }}
                    >
                      <ArrowSquareOut size={12} aria-hidden="true" />
                      <span>{t('mainLayout.open')}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

// Re-export type guard helper for edge support values if needed by callers
export type GraphEdgeSupportKind = PlanPrerequisite['support'];
