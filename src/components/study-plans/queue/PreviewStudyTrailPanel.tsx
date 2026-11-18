import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  Check,
  Eye,
  Prohibit,
  Star,
  WarningCircle,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import {
  generateStudyTrailSegments,
  overrideStudyTrailAssignment,
} from '../../../api/study-trails';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import type { StudyTrailOverview } from '../../../types/studyTrail';
import { formatEstimatedMinutes } from '../../../lib/study-plans/trail/queueProjection';

export interface PreviewStudyTrailPanelProps {
  planDetail: StudyPlanDetail;
  overview: StudyTrailOverview;
  onRefresh: () => Promise<void> | void;
  onOpenSegment?: (segmentId: string) => void;
  onClose?: () => void;
}

const COVERAGE_BADGE: Record<string, { label: string; tone: string }> = {
  adequately_covered: { label: 'Adequately Covered', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  multi_segment: { label: 'Multi-Segment', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  partially_covered: { label: 'Partially Covered', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  insufficient: { label: 'Insufficient Material', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  no_match: { label: 'No Trustworthy Match', tone: 'bg-error/15 text-error' },
  source_unavailable: { label: 'Source Unavailable', tone: 'bg-error/15 text-error' },
  revision_changed: { label: 'Source Revision Changed', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};

export const PreviewStudyTrailPanel: React.FC<PreviewStudyTrailPanelProps> = ({
  planDetail,
  overview,
  onRefresh,
  onOpenSegment,
  onClose,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodeMap = new Map(planDetail.version.nodes.map((n) => [n.nodeId, n]));
  const segmentMap = new Map(overview.segments.map((s) => [s.id, s]));

  const runAction = async (key: string, fn: () => Promise<unknown>) => {
    setBusyId(key);
    setError(null);
    try {
      await fn();
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const uncoveredCount = overview.trailItems.filter((i) => !i.segmentId).length;

  return (
    <section
      aria-label="Preview and inspect Study Trail"
      className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/60 pb-3">
        <div>
          <h3 className="text-base font-semibold text-on-surface">Preview Study Trail</h3>
          <p className="text-xs text-on-surface-variant">
            Inspect instructional quality, reject irrelevant matches, swap alternatives, or regenerate individual objectives.
            Manual overrides are preserved during regeneration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {uncoveredCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              {uncoveredCount} uncovered objective{uncoveredCount === 1 ? '' : 's'}
            </span>
          )}
          {onClose && (
            <Button variant="tonal" size="sm" onClick={onClose}>
              Done Inspecting
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}

      {overview.diagnostics.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
            <WarningCircle size={15} />
            <span>Diagnostics</span>
          </div>
          <ul className="list-disc pl-4 text-xs text-amber-800/90 dark:text-amber-200/90 space-y-0.5">
            {overview.diagnostics.slice(0, 6).map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {overview.trailItems.map((item, idx) => {
          const node = nodeMap.get(item.nodeId);
          const objectiveText = node?.learningObjectives[item.objectiveIndex] ?? node?.title ?? item.nodeId;
          const seg = item.segmentId ? segmentMap.get(item.segmentId) ?? null : null;
          const links = overview.objectiveLinks.filter(
            (l) => l.nodeId === item.nodeId && l.objectiveIndex === item.objectiveIndex,
          );
          const primaryLink = links.find((l) => l.segmentId === item.segmentId) ?? links[0];
          const alternatives = links.filter((l) => l.segmentId !== item.segmentId);
          const coverage = primaryLink?.coverageStatus ?? (seg ? 'adequately_covered' : 'no_match');
          const badge = COVERAGE_BADGE[coverage] ?? COVERAGE_BADGE.no_match;
          const docTitle = seg ? overview.documentTitles[seg.documentId] ?? seg.title : 'No verified source';

          return (
            <article
              key={item.id}
              className="rounded-xl border border-outline-variant/80 bg-surface p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono text-on-surface-variant">#{idx + 1}</span>
                    <h4 className="text-sm font-semibold text-on-surface">{node?.title ?? item.nodeId}</h4>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.tone}`}>
                      {badge.label}
                    </span>
                    {primaryLink?.authoredOverride && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Manual Override
                      </span>
                    )}
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] text-on-surface-variant">
                      {item.isRequired ? 'Required' : 'Optional'}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant">Objective: {objectiveText}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    variant="text"
                    size="iconSm"
                    disabled={idx === 0 || busyId !== null}
                    aria-label="Move assignment earlier"
                    onClick={() =>
                      void runAction(`up:${item.id}`, () =>
                        overrideStudyTrailAssignment({
                          itemId: item.id,
                          manualOrderOverride: Math.max(1, item.trailOrder - 1),
                        }),
                      )
                    }
                  >
                    <ArrowUp size={15} />
                  </Button>
                  <Button
                    variant="text"
                    size="iconSm"
                    disabled={idx === overview.trailItems.length - 1 || busyId !== null}
                    aria-label="Move assignment later"
                    onClick={() =>
                      void runAction(`down:${item.id}`, () =>
                        overrideStudyTrailAssignment({
                          itemId: item.id,
                          manualOrderOverride: item.trailOrder + 1,
                        }),
                      )
                    }
                  >
                    <ArrowDown size={15} />
                  </Button>
                  <Button
                    variant="outlined"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() =>
                      void runAction(`regen:${item.id}`, () =>
                        generateStudyTrailSegments({
                          planId: planDetail.plan.id,
                          versionId: planDetail.version.id,
                          nodeId: item.nodeId,
                          objectiveIndex: item.objectiveIndex,
                        }),
                      )
                    }
                  >
                    <ArrowsClockwise size={14} />
                    <span>Regenerate Objective</span>
                  </Button>
                </div>
              </div>

              {seg ? (
                <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-on-surface">
                      {docTitle} — {seg.parentSectionLabel ?? seg.title}
                    </span>
                    <span className="text-on-surface-variant">
                      ~{formatEstimatedMinutes(seg.estimatedDurationSeconds)} min · {seg.structuralClass.replace(/_/g, ' ')} ·{' '}
                      {seg.validationStatus}
                      {seg.qualityScore != null ? ` · Quality ${Math.round(seg.qualityScore * 100)}%` : ''}
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant italic line-clamp-3">“{seg.excerptPreview}”</p>
                  <p className="text-[11px] text-on-surface-variant">
                    <strong>Why selected:</strong> {primaryLink?.selectionRationale ?? item.plannerRationale}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {onOpenSegment && (
                      <Button variant="tonal" size="sm" onClick={() => onOpenSegment(seg.id)}>
                        <Eye size={14} />
                        <span>Inspect in Reader</span>
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() =>
                        void runAction(`accept:${item.id}`, () =>
                          overrideStudyTrailAssignment({ itemId: item.id, segmentId: seg.id }),
                        )
                      }
                    >
                      <Check size={14} />
                      <span>Accept</span>
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() =>
                        void runAction(`req:${item.id}`, () =>
                          overrideStudyTrailAssignment({ itemId: item.id, isRequired: !item.isRequired }),
                        )
                      }
                    >
                      <Star size={14} />
                      <span>{item.isRequired ? 'Make Optional' : 'Make Required'}</span>
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      disabled={busyId !== null}
                      onClick={() =>
                        void runAction(`reject:${item.id}`, () =>
                          overrideStudyTrailAssignment({
                            itemId: item.id,
                            rejectedReason: 'Marked irrelevant by author',
                          }),
                        )
                      }
                    >
                      <Prohibit size={14} />
                      <span>Reject Irrelevant</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-on-surface-variant">
                  No trustworthy instructional passage was found in the selected sources. Add or index more source material, or regenerate this objective.
                </p>
              )}

              {alternatives.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                    Alternative Passages ({alternatives.length})
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {alternatives.map((alt) => {
                      const altSeg = segmentMap.get(alt.segmentId);
                      if (!altSeg) return null;
                      return (
                        <div
                          key={alt.id}
                          className="rounded-lg border border-outline-variant/60 bg-surface-container-low p-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-on-surface truncate">
                              {overview.documentTitles[altSeg.documentId] ?? altSeg.title} — {altSeg.title}
                            </p>
                            <p className="text-[11px] text-on-surface-variant truncate">
                              ~{formatEstimatedMinutes(altSeg.estimatedDurationSeconds)} min · {alt.selectionRationale}
                            </p>
                          </div>
                          <Button
                            variant="tonal"
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() =>
                              void runAction(`swap:${item.id}:${altSeg.id}`, () =>
                                overrideStudyTrailAssignment({ itemId: item.id, segmentId: altSeg.id }),
                              )
                            }
                          >
                            Use This
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
