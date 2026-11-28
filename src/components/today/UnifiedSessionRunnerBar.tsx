import { useState } from "react";
import {
  Check,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  Pause,
  Play,
  Question,
  SkipForward,
  X,
} from "@phosphor-icons/react";
import { useLearningSessionStore } from "../../stores/learningSessionStore";
import { openScrollModeForSession } from "../../lib/learning-runtime/scrollSessionLauncher";
import type {
  LearningActivity,
  LearningActivityType,
  LearningSessionSummary,
} from "../../types/learningActivity";
import { cn } from "../../utils/cn";

export interface UnifiedSessionRunnerBarProps {
  onOpenActivity?: (activity: LearningActivity) => void | Promise<void>;
  className?: string;
}

const BUDGET_PRESETS: ReadonlyArray<{ value: number | null; label: string }> = [
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "60m" },
  { value: 120, label: "120m" },
  { value: null, label: "Unlimited" },
];

const ACTIVITY_TYPE_LABELS: Record<LearningActivityType, string> = {
  source_reading: "Reading",
  media_consumption: "Media",
  flashcard_review: "Flashcards",
  extract_review: "Extracts",
  guided_reading: "Guided Reading",
  comprehension_check: "Comprehension Check",
  socratic_tutoring: "Socratic Tutor",
  free_response_practice: "Free Response",
  objective_question_practice: "Practice",
  structured_problem_solving: "Problem Solving",
  rubric_assessment: "Assessment",
  reflection_formulation: "Reflection",
  targeted_remediation: "Remediation",
};

function formatBudgetLabel(minutes: number | null): string {
  return minutes === null ? "Unlimited" : `${minutes}m`;
}

function getCurrentActivity(
  activities: readonly LearningActivity[],
  currentIndex: number,
): LearningActivity | null {
  if (activities.length === 0) return null;
  const clamped = Math.max(0, Math.min(currentIndex, activities.length - 1));
  return activities[clamped] ?? null;
}

function getOpenActivityLabel(activity: LearningActivity, profileId?: string): string {
  switch (activity.activityType) {
    case "flashcard_review":
      return "Start review";
    case "extract_review":
      return "Open extracts";
    case "source_reading":
    case "guided_reading":
    case "media_consumption": {
      const hasDoc =
        activity.sourceReferences.some((ref) => Boolean(ref.documentId)) ||
        activity.dedupeKey.startsWith("document:");
      if (hasDoc) return "Open reading";
      if (profileId === "free_exploration") return "Open priority queue";
      if (activity.goalReferences.length > 0) return "Open goal queue";
      return "Open Scroll Mode";
    }
    default:
      return activity.goalReferences.length > 0 ? "Open goal queue" : "Open Scroll Mode";
  }
}

async function launchLearningActivity(
  activity: LearningActivity,
  profileId?: string,
): Promise<void> {
  const [{ useTabsStore }, { createCanonicalTab }] = await Promise.all([
    import("../../stores/tabsStore"),
    import("../tabs/TabRegistry"),
  ]);
  const addTab = useTabsStore.getState().addTab;

  if (activity.activityType === "flashcard_review") {
    addTab(createCanonicalTab("review"));
    const { useReviewStore } = await import("../../stores/reviewStore");
    const reviewStore = useReviewStore.getState();
    await reviewStore.loadQueue();
    if (useReviewStore.getState().queue.length > 0) {
      useReviewStore.getState().setReviewTabMode("session");
    }
    return;
  }

  if (activity.activityType === "extract_review") {
    addTab(createCanonicalTab("extracts"));
    return;
  }

  const documentId =
    activity.sourceReferences.find((ref) => ref.documentId)?.documentId ??
    (activity.dedupeKey.startsWith("document:")
      ? activity.dedupeKey.slice("document:".length)
      : null);

  if (documentId) {
    const { openDocumentAtLocation } = await import("../../utils/openDocumentAtLocation");
    await openDocumentAtLocation(documentId, { ensureExists: true }, addTab);
    return;
  }

  await openScrollModeForSession({ profileId });
}

export function UnifiedSessionRunnerBar({
  onOpenActivity,
  className,
}: UnifiedSessionRunnerBarProps) {
  const activeSession = useLearningSessionStore((s) => s.activeSession);
  const startActivity = useLearningSessionStore((s) => s.startActivity);
  const completeActivity = useLearningSessionStore((s) => s.completeActivity);
  const skipActivity = useLearningSessionStore((s) => s.skipActivity);
  const postponeActivity = useLearningSessionStore((s) => s.postponeActivity);
  const revisitActivity = useLearningSessionStore((s) => s.revisitActivity);
  const adjustBudget = useLearningSessionStore((s) => s.adjustBudget);
  const pauseSession = useLearningSessionStore((s) => s.pauseSession);
  const resumeSession = useLearningSessionStore((s) => s.resumeSession);
  const completeSession = useLearningSessionStore((s) => s.completeSession);
  const abandonSession = useLearningSessionStore((s) => s.abandonSession);

  const [showWhyPopover, setShowWhyPopover] = useState(false);
  const [showBudgetMenu, setShowBudgetMenu] = useState(false);
  const [completedSummary, setCompletedSummary] = useState<LearningSessionSummary | null>(null);

  if (!activeSession && completedSummary) {
    const ratePercent = Math.round(completedSummary.completionRate * 100);
    return (
      <section
        aria-label="Session summary"
        className={cn(
          "rounded-2xl border border-primary/30 bg-card p-5 shadow-sm",
          className,
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <CheckCircle className="h-5 w-5" weight="fill" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Session complete
              </h3>
              <p className="text-sm text-muted-foreground">
                {completedSummary.title} · {completedSummary.completedCount} of{" "}
                {completedSummary.totalActivities} completed ({ratePercent}%)
                {completedSummary.skippedCount > 0
                  ? ` · ${completedSummary.skippedCount} skipped`
                  : ""}
                {completedSummary.postponedCount > 0
                  ? ` · ${completedSummary.postponedCount} postponed`
                  : ""}
              </p>
              {completedSummary.postponedCount > 0 && (
                <p className="mt-1 text-xs text-primary">
                  You still have postponed review items waiting—pick them up anytime from Start learning.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCompletedSummary(null)}
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Done
          </button>
        </div>
      </section>
    );
  }

  if (!activeSession || (activeSession.status !== "active" && activeSession.status !== "paused")) {
    return null;
  }

  const totalCount = activeSession.activities.length;
  const completedCount = activeSession.activities.filter((a) => a.status === "completed").length;
  const postponedActivities = activeSession.activities.filter((a) => a.status === "postponed");
  const resolvedCount = activeSession.activities.filter(
    (a) => a.status === "completed" || a.status === "skipped" || a.status === "postponed",
  ).length;
  const progressPercent = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
  const currentActivity = getCurrentActivity(
    activeSession.activities,
    activeSession.currentActivityIndex,
  );
  const allResolved = totalCount > 0 && resolvedCount >= totalCount;
  const isPaused = activeSession.status === "paused";

  const handleOpenCurrent = () => {
    if (!currentActivity) return;
    setShowWhyPopover(false);
    startActivity(currentActivity.id);
    if (onOpenActivity) {
      void onOpenActivity(currentActivity);
    } else {
      void launchLearningActivity(currentActivity, activeSession.profileId);
    }
  };

  const handleCompleteCurrent = () => {
    if (!currentActivity) return;
    setShowWhyPopover(false);
    const updated = completeActivity(currentActivity.id);
    if (updated) {
      const remaining = updated.activities.filter(
        (a) =>
          a.status === "pending" ||
          a.status === "in_progress" ||
          a.status === "postponed",
      );
      if (remaining.length === 0) {
        const summary = completeSession();
        if (summary) {
          setCompletedSummary(summary);
        }
      }
    }
  };

  const handleFinishSession = () => {
    setShowWhyPopover(false);
    setShowBudgetMenu(false);
    const summary = completeSession();
    if (summary) {
      setCompletedSummary(summary);
    }
  };

  const handleExitSession = () => {
    setShowWhyPopover(false);
    setShowBudgetMenu(false);
    abandonSession();
  };

  return (
    <section
      aria-label="Active learning session"
      className={cn(
        "rounded-2xl border border-primary/35 bg-card p-4 md:p-5 shadow-sm",
        className,
      )}
    >
      {/* Top status & progress row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              isPaused
                ? "bg-muted text-muted-foreground"
                : "bg-primary/15 text-primary",
            )}
          >
            {isPaused ? "Paused" : "Active session"}
          </span>
          <h3 className="truncate text-sm font-semibold text-foreground">
            {activeSession.title}
          </h3>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount} completed
            {postponedActivities.length > 0 && !allResolved
              ? ` · ${postponedActivities.length} postponed (we'll nudge you later)`
              : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Adjust time budget */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowBudgetMenu((prev) => !prev)}
              aria-expanded={showBudgetMenu}
              aria-label="Adjust time budget"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span>{formatBudgetLabel(activeSession.timeBudgetMinutes)}</span>
            </button>

            {showBudgetMenu && (
              <div
                role="group"
                aria-label="Select session time budget"
                className="absolute right-0 top-full z-20 mt-1.5 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-2 shadow-lg min-w-[200px]"
              >
                {BUDGET_PRESETS.map((preset) => {
                  const selected = activeSession.timeBudgetMinutes === preset.value;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        adjustBudget(preset.value);
                        setShowBudgetMenu(false);
                      }}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground hover:bg-accent",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pause / Resume */}
          <button
            type="button"
            onClick={() => (isPaused ? resumeSession() : pauseSession())}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {isPaused ? (
              <>
                <Play className="h-3.5 w-3.5" weight="fill" aria-hidden="true" />
                Resume
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                Pause
              </>
            )}
          </button>

          {/* Finish session */}
          <button
            type="button"
            onClick={handleFinishSession}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Finish
          </button>

          {/* Exit session */}
          <button
            type="button"
            onClick={handleExitSession}
            aria-label="Exit session"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Exit
          </button>
        </div>
      </div>

      {/* Queue progress bar */}
      <div className="mt-3">
        <div
          role="progressbar"
          aria-label="Session queue progress"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Current activity */}
      {currentActivity && !allResolved ? (
        <div className="mt-3.5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                {ACTIVITY_TYPE_LABELS[currentActivity.activityType] ?? currentActivity.activityType}
              </span>
              <span>~{currentActivity.estimatedMinutes}m</span>
              <span>
                Step {Math.min(activeSession.currentActivityIndex + 1, totalCount)} of {totalCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm md:text-base font-semibold text-foreground">
                {currentActivity.title}
              </p>
              <button
                type="button"
                onClick={() => setShowWhyPopover((prev) => !prev)}
                aria-expanded={showWhyPopover}
                aria-controls="today-why-popover"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Question className="h-3.5 w-3.5" aria-hidden="true" />
                Why am I seeing this?
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenCurrent}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Play className="h-3.5 w-3.5" weight="fill" aria-hidden="true" />
              {getOpenActivityLabel(currentActivity, activeSession.profileId)}
            </button>
            <button
              type="button"
              onClick={handleCompleteCurrent}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Complete
            </button>
            <button
              type="button"
              onClick={() => {
                setShowWhyPopover(false);
                skipActivity(currentActivity.id);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
              Skip
            </button>
            <button
              type="button"
              onClick={() => {
                setShowWhyPopover(false);
                postponeActivity(currentActivity.id);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ClockCounterClockwise className="h-3.5 w-3.5" aria-hidden="true" />
              Postpone
            </button>
          </div>
        </div>
      ) : postponedActivities.length > 0 ? (
        <div className="mt-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Ready to revisit your postponed{" "}
              {postponedActivities.length === 1
                ? postponedActivities[0].title
                : `${postponedActivities.length} activities`}
              ?
            </p>
            <p className="text-xs text-muted-foreground">
              You moved past this earlier—pick it back up now or finish for today.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowWhyPopover(false);
                revisitActivity(postponedActivities[0].id);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ClockCounterClockwise className="h-3.5 w-3.5" aria-hidden="true" />
              Revisit {postponedActivities[0].title}
            </button>
            <button
              type="button"
              onClick={handleFinishSession}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Finish for now
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            All queued activities are finished.
          </p>
          <button
            type="button"
            onClick={handleFinishSession}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground"
          >
            View summary
          </button>
        </div>
      )}

      {/* Deterministic "Why am I seeing this?" popover */}
      {showWhyPopover && currentActivity && (
        <div
          id="today-why-popover"
          role="region"
          aria-label="Recommendation explanation"
          className="mt-3 rounded-xl border border-border bg-muted/40 p-3.5 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1.5">
              <p className="font-semibold text-foreground">Why am I seeing this?</p>
              <p className="text-foreground/90">{currentActivity.recommendationReason}</p>
              {currentActivity.priorityMetadata.factors &&
                currentActivity.priorityMetadata.factors.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {currentActivity.priorityMetadata.factors.map((factor) => (
                      <li
                        key={factor.key}
                        className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {factor.label}
                      </li>
                    ))}
                  </ul>
                )}
              <p className="text-[11px] text-muted-foreground">
                Deterministic local ranking · no AI required
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowWhyPopover(false)}
              aria-label="Close explanation"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
