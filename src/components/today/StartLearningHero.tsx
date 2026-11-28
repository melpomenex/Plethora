import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock,
  Compass,
  Play,
  SlidersHorizontal,
  Sparkle,
} from "@phosphor-icons/react";
import {
  orchestrateLearningSession,
  type DaqeActivityCandidate,
  type LearningActivityKind,
  type RankedActivityItem,
  type SessionFocusProfile,
  type SessionTimeBudget,
} from "../../lib/daqe/orchestrator";
import { useLearningGoalsStore } from "../../stores/learningGoalsStore";
import { useLearningSessionStore } from "../../stores/learningSessionStore";
import { openScrollModeForSession } from "../../lib/learning-runtime/scrollSessionLauncher";
import type {
  LearningActivity,
  LearningActivityType,
  LearningSession,
} from "../../types/learningActivity";
import { cn } from "../../utils/cn";

export interface TodayResumableDocument {
  id: string;
  title: string;
  progress?: number;
}

export interface StartLearningHeroProps {
  dueCount?: number;
  resumableDocs?: readonly TodayResumableDocument[];
  onImportDocument?: () => void;
  onOpenAddGoal?: () => void;
  onSessionStarted?: (session: LearningSession) => void;
  onContinueSession?: (session: LearningSession) => void;
  className?: string;
}

interface FocusProfileOption {
  id: Exclude<SessionFocusProfile, "custom">;
  label: string;
  description: string;
}

const FOCUS_PROFILE_OPTIONS: readonly FocusProfileOption[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Mix due reviews, goals, and reading",
  },
  {
    id: "free_exploration",
    label: "Free Exploration",
    description: "Follow curiosity with zero pressure",
  },
  {
    id: "memory_retention",
    label: "Memory Retention",
    description: "Prioritize due spaced-repetition cards",
  },
  {
    id: "exam_prep",
    label: "Exam Prep",
    description: "Focus on deadlines and knowledge gaps",
  },
  {
    id: "deep_study",
    label: "Deep Study",
    description: "Longer uninterrupted focus blocks",
  },
];

interface TimeBudgetOption {
  value: SessionTimeBudget;
  label: string;
}

const TIME_BUDGET_OPTIONS: readonly TimeBudgetOption[] = [
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "60m" },
  { value: 120, label: "120m" },
  { value: "unlimited", label: "Unlimited" },
];

function mapCandidateKindToActivityType(kind: LearningActivityKind): LearningActivityType {
  switch (kind) {
    case "srs_review":
      return "flashcard_review";
    case "guided_reading":
      return "guided_reading";
    case "remediation":
      return "targeted_remediation";
    case "practice_check":
      return "comprehension_check";
    case "exam_attempt":
      return "objective_question_practice";
    case "incremental_read":
    case "study_workspace":
    case "exploration_feed":
    case "pinned_item":
    case "continue_reading":
    default:
      return "source_reading";
  }
}

function rankedItemToLearningActivity(item: RankedActivityItem): LearningActivity {
  const { candidate, explanation, score } = item;
  return {
    id: `act_${candidate.id}`,
    activityType: mapCandidateKindToActivityType(candidate.activityKind),
    title: candidate.title,
    status: "pending",
    dedupeKey: candidate.dedupeKey,
    sourceReferences: [
      {
        entityKind: candidate.activityKind === "srs_review" ? "learning_item" : "document",
        entityId: candidate.id,
        documentId: candidate.dedupeKey.startsWith("document:")
          ? candidate.dedupeKey.slice("document:".length)
          : null,
        label: candidate.title,
      },
    ],
    conceptReferences: [],
    goalReferences: candidate.goalReferences.map((g) => g.goalId),
    estimatedMinutes: candidate.estimatedMinutes,
    priorityMetadata: {
      score,
      providerId: candidate.providerKind,
      dueAt: candidate.dueAt ?? null,
      factors: explanation.factors
        .filter((f) => f.state !== "unavailable" && f.signedContribution !== 0)
        .map((f) => ({
          key: f.key,
          label: f.label,
          contribution: f.signedContribution,
        })),
    },
    prerequisiteRequirements: [],
    recommendationReason: explanation.primaryReason,
    capabilityRequirements: { required: [], optional: [] },
    resumeState: null,
    completionPolicy: { mode: "explicit" },
    isLocalOnly: Boolean(candidate.isLocalOnly),
    isAiExcluded: Boolean(candidate.isAiExcluded),
    examIsolated: false,
  };
}

function buildSessionTitle(profile: SessionFocusProfile): string {
  const match = FOCUS_PROFILE_OPTIONS.find((opt) => opt.id === profile);
  return match ? `Today · ${match.label}` : "Today's Learning Session";
}

export function StartLearningHero({
  dueCount = 0,
  resumableDocs = [],
  onImportDocument,
  onOpenAddGoal,
  onSessionStarted,
  onContinueSession,
  className,
}: StartLearningHeroProps) {
  const activeSession = useLearningSessionStore((s) => s.activeSession);
  const resumeSession = useLearningSessionStore((s) => s.resumeSession);
  const goals = useLearningGoalsStore((s) => s.goals);

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );

  const isCasualEmptyState = dueCount === 0 && activeGoals.length === 0;

  const [selectedProfile, setSelectedProfile] = useState<Exclude<SessionFocusProfile, "custom"> | null>(
    null,
  );
  const [timeBudget, setTimeBudget] = useState<SessionTimeBudget>(15);
  const [showCustomize, setShowCustomize] = useState(false);

  const focusProfile: Exclude<SessionFocusProfile, "custom"> =
    selectedProfile ?? (isCasualEmptyState ? "free_exploration" : "balanced");

  const hasContinuableSession =
    activeSession !== null &&
    (activeSession.status === "paused" || activeSession.status === "active");

  const handleStartLearning = () => {
    const candidates: DaqeActivityCandidate[] = [];

    if (dueCount > 0) {
      const rawSrsMinutes = Math.min(20, Math.max(5, Math.ceil(dueCount * 0.5)));
      const srsShare = focusProfile === "memory_retention" ? 0.7 : 0.5;
      const srsMinutes =
        typeof timeBudget === "number"
          ? Math.min(rawSrsMinutes, Math.max(2, Math.floor(timeBudget * srsShare)))
          : rawSrsMinutes;

      candidates.push({
        id: "srs-due-batch",
        dedupeKey: "srs:due-batch",
        title: `Review due cards (${dueCount} due)`,
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: srsMinutes,
        signals: {
          srsUrgency: Math.min(1, 0.55 + dueCount * 0.03),
          durationFit: 0.85,
        },
        retrievability: 0.72,
      });
    }

    const readingMinutes =
      typeof timeBudget === "number"
        ? Math.max(2, Math.min(10, Math.floor(timeBudget * 0.5)))
        : 10;

    for (const doc of resumableDocs.slice(0, 3)) {
      candidates.push({
        id: `doc-${doc.id}`,
        dedupeKey: `document:${doc.id}`,
        title: `Continue reading: ${doc.title}`,
        providerKind: "continue_reading",
        activityKind: "continue_reading",
        estimatedMinutes: readingMinutes,
        signals: {
          interest: 0.75,
          userPriority: 0.65,
          durationFit: 0.8,
        },
      });
    }

    for (const goal of activeGoals.slice(0, 4)) {
      const hasDeadline = Boolean(goal.targetDate);
      candidates.push({
        id: `goal-${goal.id}`,
        dedupeKey: `goal:${goal.id}`,
        title: goal.title,
        providerKind: hasDeadline ? "exam_prep" : "learning_goals",
        activityKind: hasDeadline ? "exam_attempt" : "study_workspace",
        estimatedMinutes: Math.min(30, Math.max(10, goal.dailyMinutesBudget ?? 15)),
        signals: {
          goalAlignment: 0.85,
          deadlinePressure: hasDeadline ? 0.82 : null,
          interest: goal.kind === "exploration" ? 0.8 : 0.5,
          durationFit: 0.8,
        },
        goalReferences: [
          {
            goalId: goal.id,
            goalTitle: goal.title,
          },
        ],
      });
    }

    // Always include a library reading/exploration candidate when there are no
    // in-progress reading docs so the user can move from card review into
    // reviewing or exploring material (and vice versa).
    if (resumableDocs.length === 0) {
      candidates.push({
        id: "free-exploration-read",
        dedupeKey: "exploration:today-open-reading",
        title: "Explore something from your library",
        providerKind: "continue_reading",
        activityKind: focusProfile === "free_exploration" ? "exploration_feed" : "incremental_read",
        estimatedMinutes:
          typeof timeBudget === "number"
            ? Math.max(2, Math.min(15, Math.ceil(timeBudget * 0.5)))
            : 15,
        signals: {
          interest: 0.9,
          durationFit: 0.9,
        },
        isNewMaterial: true,
      });
    }

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile,
      timeBudgetMinutes: timeBudget,
    });

    const chosen = plan.selected.length > 0 ? plan.selected : plan.ranked.slice(0, 1);
    const activities = chosen.map(rankedItemToLearningActivity);

    const session = useLearningSessionStore.getState().startNewSession({
      title: buildSessionTitle(focusProfile),
      profileId: focusProfile,
      timeBudgetMinutes: timeBudget === "unlimited" ? null : timeBudget,
      activities,
    });

    if (
      focusProfile === "free_exploration" ||
      (activities[0] && activities[0].activityType !== "flashcard_review")
    ) {
      void openScrollModeForSession({
        profileId: focusProfile,
        goals: activeGoals,
      });
    }

    onSessionStarted?.(session);
  };

  const handleContinuePrevious = () => {
    if (!activeSession) return;
    const next =
      activeSession.status === "paused" ? resumeSession() ?? activeSession : activeSession;
    onContinueSession?.(next);
  };

  const activeProfileMeta =
    FOCUS_PROFILE_OPTIONS.find((opt) => opt.id === focusProfile) ?? FOCUS_PROFILE_OPTIONS[0];
  const activeBudgetLabel =
    TIME_BUDGET_OPTIONS.find((opt) => opt.value === timeBudget)?.label ?? `${timeBudget}m`;

  return (
    <section
      aria-label="Today learning launcher"
      className={cn(
        "rounded-2xl border border-border bg-card p-5 md:p-6 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-primary">
            <Sparkle className="h-4 w-4" aria-hidden="true" />
            <span>Today</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {activeProfileMeta.label} · {activeBudgetLabel}
            </span>
          </div>

          <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-foreground">
            {isCasualEmptyState
              ? resumableDocs.length > 0
                ? "Pick up right where you left off"
                : "Ready for a calm, self-paced session"
              : "Your personalized learning session is ready"}
          </h2>

          <p className="text-sm text-muted-foreground max-w-2xl">
            {isCasualEmptyState
              ? resumableDocs.length > 0
                ? "No due cards or deadlines today. Jump straight into reading or start a free-exploration session whenever you like."
                : "No goals, reviews, or AI setup required. Start exploring right away or import something to read."
              : `${dueCount > 0 ? `${dueCount} due for review` : "No due cards"}${
                  activeGoals.length > 0
                    ? ` · ${activeGoals.length} active learning ${activeGoals.length === 1 ? "goal" : "goals"}`
                    : ""
                }. Ranked locally with transparent reasons.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleStartLearning}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Play className="h-4 w-4" weight="fill" aria-hidden="true" />
            Start learning
          </button>

          {hasContinuableSession && (
            <button
              type="button"
              onClick={handleContinuePrevious}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
              Continue previous session
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCustomize((prev) => !prev)}
            aria-expanded={showCustomize}
            aria-controls="today-session-customize-panel"
            aria-label="Customize session"
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              showCustomize
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-foreground hover:bg-accent",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Customize session
          </button>
        </div>
      </div>

      {isCasualEmptyState && (onImportDocument || onOpenAddGoal) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Self-paced mode · works offline without AI
          </span>
          {onImportDocument && (
            <button
              type="button"
              onClick={onImportDocument}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Import a document
            </button>
          )}
          {onOpenAddGoal && (
            <button
              type="button"
              onClick={onOpenAddGoal}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              Add an optional goal
            </button>
          )}
        </div>
      )}

      {showCustomize && (
        <div
          id="today-session-customize-panel"
          className="mt-4 space-y-4 rounded-xl border border-border bg-muted/30 p-4"
        >
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Session Focus Profile
            </div>
            <div
              role="radiogroup"
              aria-label="Session Focus Profile"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5"
            >
              {FOCUS_PROFILE_OPTIONS.map((option) => {
                const isSelected = focusProfile === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedProfile(option.id)}
                    className={cn(
                      "flex flex-col items-start rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    <span className="text-xs font-semibold">{option.label}</span>
                    <span className="mt-0.5 text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Time Budget</span>
            </div>
            <div
              role="radiogroup"
              aria-label="Time Budget"
              className="flex flex-wrap items-center gap-2"
            >
              {TIME_BUDGET_OPTIONS.map((option) => {
                const isSelected = timeBudget === option.value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setTimeBudget(option.value)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
