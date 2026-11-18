import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowsClockwise,
  BookOpen,
  CheckCircle,
  Clock,
  Eye,
  Flag,
  GitBranch,
  GraduationCap,
  Lock,
  Play,
  SlidersHorizontal,
  Sparkle,
  Warning,
} from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import {
  generateStudyTrailSegments,
  getRemediationTrailItems,
  getStudyTrailOverview,
  overrideStudyTrailAssignment,
  updateStudyTrailItemProgress,
} from '../../../api/study-trails';
import {
  projectStudyQueue,
  type StudyQueueEntry,
} from '../../../lib/study-plans/trail/queueProjection';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import type {
  AssessmentEligibilityPolicy,
  LearningSegment,
  StudyTrailOverview,
} from '../../../types/studyTrail';
import { FormativeCheckDrawer } from './FormativeCheckDrawer';
import { PreviewStudyTrailPanel } from './PreviewStudyTrailPanel';

export interface StudyQueueViewProps {
  planDetail: StudyPlanDetail;
  onStartGuidedReading: (entry: StudyQueueEntry, overview: StudyTrailOverview) => void;
  onInspectNode: (nodeId: string) => void;
  onOpenGraph: () => void;
  onOpenAssessments: () => void;
}

export const StudyQueueView: React.FC<StudyQueueViewProps> = ({
  planDetail,
  onStartGuidedReading,
  onInspectNode,
  onOpenGraph,
  onOpenAssessments,
}) => {
  const [overview, setOverview] = useState<StudyTrailOverview | null>(null);
  const [policy, setPolicy] = useState<AssessmentEligibilityPolicy>('guided');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [checkEntry, setCheckEntry] = useState<StudyQueueEntry | null>(null);
  const [expandedRationaleId, setExpandedRationaleId] = useState<string | null>(null);

  const planId = planDetail.plan.id;
  const versionId = planDetail.version.id;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStudyTrailOverview(planId, versionId, policy);
      const remediation = await getRemediationTrailItems(planId, versionId).catch(() => []);
      if (remediation.length > 0) {
        const refreshed = await getStudyTrailOverview(planId, versionId, policy);
        setOverview(refreshed ?? data);
      } else {
        setOverview(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Study Queue');
    } finally {
      setLoading(false);
    }
  }, [planId, versionId, policy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generateStudyTrailSegments({ planId, versionId, policy });
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Study Trail');
    } finally {
      setGenerating(false);
    }
  };

  const handleDefer = async (entry: StudyQueueEntry) => {
    await updateStudyTrailItemProgress({
      itemId: entry.item.id,
      status: 'deferred',
      readingProgress: entry.item.readingProgress,
      lastLocator: entry.item.lastLocator ?? null,
    });
    await refresh();
  };

  const handleReportIrrelevant = async (entry: StudyQueueEntry) => {
    await overrideStudyTrailAssignment({
      itemId: entry.item.id,
      rejectedReason: 'Reported irrelevant by learner',
    });
    await refresh();
  };

  const handleSwapAlternative = async (entry: StudyQueueEntry, segment: LearningSegment) => {
    await overrideStudyTrailAssignment({
      itemId: entry.item.id,
      segmentId: segment.id,
    });
    await refresh();
  };

  const projection = projectStudyQueue(planDetail, overview);
  const next = projection.nextRecommended;

  if (loading && !overview) {
    return (
      <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-6 text-sm text-on-surface-variant">
        Loading Study Queue…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="study-queue-view">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="tonal"
            size="sm"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            <ArrowsClockwise size={15} />
            <span>
              {generating
                ? 'Analyzing Sources…'
                : overview && overview.trailItems.length > 0
                  ? 'Rebuild Study Trail'
                  : 'Generate Study Trail'}
            </span>
          </Button>
          {overview && overview.trailItems.length > 0 && (
            <Button
              variant={showPreview ? 'filled' : 'outlined'}
              size="sm"
              onClick={() => setShowPreview((v) => !v)}
            >
              <SlidersHorizontal size={15} />
              <span>{showPreview ? 'Hide Trail Inspector' : 'Preview & Edit Trail'}</span>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="text" size="sm" onClick={onOpenGraph}>
            <GitBranch size={15} />
            <span>Curriculum Graph</span>
          </Button>
          <Button variant="text" size="sm" onClick={onOpenAssessments}>
            <GraduationCap size={15} />
            <span>Assessments</span>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-error/40 bg-error/10 p-3 text-xs text-error">
          {error}
        </div>
      )}

      {showPreview && overview && (
        <PreviewStudyTrailPanel
          planDetail={planDetail}
          overview={overview}
          onRefresh={refresh}
          onClose={() => setShowPreview(false)}
          onOpenSegment={(segId) => {
            const matching = [...projection.upcomingItems, ...projection.completedItems, ...(next ? [next] : [])]
              .find((e) => e.segment?.id === segId);
            if (matching) onStartGuidedReading(matching, overview);
          }}
        />
      )}

      {checkEntry && (
        <FormativeCheckDrawer
          entry={checkEntry}
          onClose={() => setCheckEntry(null)}
          onCompleted={() => void refresh()}
          onReturnToReading={() => {
            if (overview) onStartGuidedReading(checkEntry, overview);
          }}
        />
      )}

      {/* Empty State when no trail generated yet */}
      {(!overview || overview.trailItems.length === 0) && (
        <section className="rounded-2xl border border-outline-variant bg-surface-container-low p-6 space-y-3">
          <h3 className="text-base font-semibold text-on-surface">Prepare Your Guided Study Trail</h3>
          <p className="text-sm text-on-surface-variant max-w-2xl">
            Plethora will analyze the structure of your selected sources, exclude tables of contents, bibliographies, and
            incidental mentions, and assemble coherent, prerequisite-ordered reading assignments for each learning objective.
          </p>
          <Button variant="filled" size="md" disabled={generating} onClick={() => void handleGenerate()}>
            <Sparkle size={16} />
            <span>{generating ? 'Generating Learning Segments…' : 'Generate Study Trail'}</span>
          </Button>
        </section>
      )}

      {/* Primary Hero: Continue Learning */}
      {next && overview && (
        <section
          aria-label="Continue Learning"
          data-testid="study-queue-continue-card"
          className="rounded-2xl border border-primary/35 bg-primary/5 p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkle size={15} />
              <span>{next.item.isRemediation ? 'Targeted Remediation' : 'Continue Learning'}</span>
            </div>
            {next.estimatedMinutes > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                <Clock size={13} />
                <span>Estimated time: {next.estimatedMinutes} min</span>
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold text-on-surface">{next.node.title}</h2>
            <p className="text-sm text-on-surface-variant">
              <strong>Learning objective:</strong> {next.objectiveText}
            </p>
            {next.segment ? (
              <p className="text-sm font-medium text-on-surface flex items-center gap-1.5 pt-1">
                <BookOpen size={16} className="text-primary shrink-0" />
                <span>
                  Read: <em>{next.documentTitle}</em> — {next.segment.parentSectionLabel ?? next.segment.title}
                </span>
              </p>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                No verified instructional passage matched this objective yet. You can inspect sources or mark it complete after studying independently.
              </p>
            )}
          </div>

          {next.segment && (
            <div className="rounded-xl border border-outline-variant/60 bg-surface/80 p-3 space-y-1.5">
              <p className="text-xs text-on-surface-variant">
                <strong>Why selected:</strong> {next.item.plannerRationale}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
                <span>
                  Reading progress: {Math.round(next.item.readingProgress * 100)}%
                </span>
                <span>·</span>
                <span>After reading: Formative comprehension check</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {next.segment && (
              <Button
                variant="filled"
                size="md"
                onClick={() => onStartGuidedReading(next, overview)}
              >
                <Play size={16} />
                <span>{next.item.status === 'in_progress' ? 'Resume Guided Reading' : 'Start Guided Reading'}</span>
              </Button>
            )}
            <Button variant="tonal" size="sm" onClick={() => setCheckEntry(next)}>
              <CheckCircle size={15} />
              <span>Check Understanding</span>
            </Button>
            <Button variant="outlined" size="sm" onClick={() => onInspectNode(next.node.nodeId)}>
              <Eye size={15} />
              <span>Inspect Concept</span>
            </Button>
            <Button variant="text" size="sm" onClick={() => void handleDefer(next)}>
              <span>Mark for Later</span>
            </Button>
            {next.segment && (
              <Button variant="text" size="sm" onClick={() => void handleReportIrrelevant(next)}>
                <Flag size={14} />
                <span>Report Irrelevant</span>
              </Button>
            )}
          </div>

          {next.alternatives.length > 0 && (
            <div className="pt-2 border-t border-outline-variant/40 flex flex-wrap items-center gap-2">
              <span className="text-xs text-on-surface-variant">Alternative sources:</span>
              {next.alternatives.map((alt) => (
                <button
                  key={alt.segment.id}
                  type="button"
                  onClick={() => void handleSwapAlternative(next, alt.segment)}
                  className="text-xs underline text-primary hover:opacity-80"
                >
                  {overview.documentTitles[alt.segment.documentId] ?? alt.segment.title} ({alt.segment.title})
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Assessment Eligibility Banner */}
      {overview && overview.trailItems.length > 0 && (
        <section
          aria-label="Assessment readiness"
          className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
              <GraduationCap size={17} className="text-primary" />
              <span>
                Assessment Eligibility:{' '}
                {overview.eligibility.eligible ? 'Ready for Assessment' : 'Guided Prerequisites Pending'}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant">
              {overview.eligibility.requiredCompleted} of {overview.eligibility.requiredTotal} required assignments completed
              {' · '}
              {overview.eligibility.checksPassed} comprehension checks passed
              {overview.eligibility.blockingReasons.length > 0 &&
                ` · ${overview.eligibility.blockingReasons.join('; ')}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-on-surface-variant flex items-center gap-1.5">
              <span>Policy:</span>
              <select
                value={policy}
                onChange={(e) => setPolicy(e.target.value as AssessmentEligibilityPolicy)}
                className="rounded-lg border border-outline-variant bg-surface px-2 py-1 text-xs text-on-surface"
              >
                <option value="guided">Guided Progression</option>
                <option value="assessment-first">Assessment-First (Test-Out)</option>
                <option value="open">Open Progression</option>
              </select>
            </label>
            <Button
              variant={overview.eligibility.eligible ? 'tonal' : 'outlined'}
              size="sm"
              disabled={!overview.eligibility.eligible}
              onClick={onOpenAssessments}
            >
              <span>{overview.eligibility.testOutAvailable && !overview.eligibility.eligible ? 'Test Out' : 'Open Assessments'}</span>
              <ArrowRight size={14} />
            </Button>
          </div>
        </section>
      )}

      {/* Upcoming Queue */}
      {projection.upcomingItems.length > 0 && overview && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold text-on-surface">
            Upcoming Assignments ({projection.upcomingItems.length})
          </h3>
          <div className="space-y-2">
            {projection.upcomingItems.map((entry) => (
              <div
                key={entry.item.id}
                className="rounded-xl border border-outline-variant bg-surface p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-on-surface">{entry.node.title}</span>
                    {entry.estimatedMinutes > 0 && (
                      <span className="text-xs text-on-surface-variant">~{entry.estimatedMinutes} min</span>
                    )}
                    {entry.item.status === 'deferred' && (
                      <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] text-on-surface-variant">
                        Saved for later
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant">{entry.objectiveText}</p>
                  {entry.segment && (
                    <p className="text-xs text-on-surface-variant">
                      {entry.documentTitle} — {entry.segment.parentSectionLabel ?? entry.segment.title}
                    </p>
                  )}
                  {expandedRationaleId === entry.item.id && (
                    <p className="text-xs text-on-surface-variant pt-1">
                      <strong>Rationale:</strong> {entry.item.plannerRationale}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() =>
                      setExpandedRationaleId((id) => (id === entry.item.id ? null : entry.item.id))
                    }
                  >
                    Why?
                  </Button>
                  {entry.segment && (
                    <Button variant="tonal" size="sm" onClick={() => onStartGuidedReading(entry, overview)}>
                      Open Reader
                    </Button>
                  )}
                  <Button variant="outlined" size="sm" onClick={() => setCheckEntry(entry)}>
                    Check
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Blocked Concepts */}
      {projection.blockedItems.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
            <Lock size={15} className="text-on-surface-variant" />
            <span>Waiting on Prerequisites ({projection.blockedItems.length})</span>
          </h3>
          <div className="space-y-2">
            {projection.blockedItems.map((entry) => (
              <div
                key={entry.item.id}
                className="rounded-xl border border-outline-variant/70 bg-surface-container-low p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-sm font-medium text-on-surface">{entry.node.title}</div>
                  <p className="text-xs text-on-surface-variant">{entry.objectiveText}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <Warning size={13} />
                    <span>
                      Complete prerequisites first:{' '}
                      {entry.unmetPrerequisites.map((p) => p.title).join(', ')}
                    </span>
                  </p>
                </div>
                {entry.unmetPrerequisites[0] && (
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={() => onInspectNode(entry.unmetPrerequisites[0].nodeId)}
                  >
                    Study Prerequisite
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Completed Assignments */}
      {projection.completedItems.length > 0 && overview && (
        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
            <CheckCircle size={15} className="text-emerald-600 dark:text-emerald-400" />
            <span>Completed ({projection.completedItems.length})</span>
          </h3>
          <div className="space-y-1.5">
            {projection.completedItems.map((entry) => (
              <div
                key={entry.item.id}
                className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-on-surface">{entry.node.title}</span>
                  <span className="text-xs text-on-surface-variant ml-2">
                    {entry.segment ? `${entry.documentTitle} — ${entry.segment.title}` : entry.objectiveText}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 capitalize">
                    {entry.item.status.replace(/_/g, ' ')}
                  </span>
                  {entry.segment && (
                    <Button variant="text" size="sm" onClick={() => onStartGuidedReading(entry, overview)}>
                      Review
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
