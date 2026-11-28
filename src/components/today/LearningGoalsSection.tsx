import { useMemo } from "react";
import {
  CalendarBlank,
  Pause,
  Play,
  Plus,
  Target,
  Trash,
  TrendUp,
} from "@phosphor-icons/react";
import { useLearningGoalsStore } from "../../stores/learningGoalsStore";
import type {
  GoalFeasibilityStatus,
  LearningGoal,
  LearningGoalKind,
} from "../../types/learningGoal";
import { cn } from "../../utils/cn";

export interface LearningGoalsSectionProps {
  hidden?: boolean;
  hideWhenEmpty?: boolean;
  onAddGoal?: () => void;
  className?: string;
}

const GOAL_KIND_LABELS: Record<LearningGoalKind, string> = {
  exploration: "Exploration",
  retention: "Retention",
  mastery: "Mastery",
  deadline: "Deadline",
  skill: "Skill",
  continuous: "Continuous",
  language: "Language",
};

const FEASIBILITY_LABELS: Partial<Record<GoalFeasibilityStatus, string>> = {
  on_track: "On track",
  tight: "Tight pace",
  at_risk: "At risk",
  infeasible: "Needs adjustment",
};

export function LearningGoalsSection({
  hidden = false,
  hideWhenEmpty = false,
  onAddGoal,
  className,
}: LearningGoalsSectionProps) {
  const goals = useLearningGoalsStore((s) => s.goals);
  const feasibilityByGoalId = useLearningGoalsStore((s) => s.feasibilityByGoalId);
  const pauseGoal = useLearningGoalsStore((s) => s.pauseGoal);
  const resumeGoal = useLearningGoalsStore((s) => s.resumeGoal);
  const evolveGoal = useLearningGoalsStore((s) => s.evolveGoal);
  const deleteGoal = useLearningGoalsStore((s) => s.deleteGoal);
  const openWizard = useLearningGoalsStore((s) => s.openWizard);

  const visibleGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active" || goal.status === "paused"),
    [goals],
  );

  if (hidden) return null;
  if (visibleGoals.length === 0 && hideWhenEmpty) return null;

  const handleAddGoal = () => {
    if (onAddGoal) {
      onAddGoal();
    } else {
      openWizard();
    }
  };

  const handleEvolveGoal = (goal: LearningGoal) => {
    const nextKind: LearningGoalKind =
      goal.kind === "exploration" ? "mastery" : "deadline";
    void evolveGoal(goal.id, { kind: nextKind });
  };

  if (visibleGoals.length === 0) {
    return (
      <section
        aria-label="Learning Goals"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3",
          className,
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Target className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>No learning goals yet — completely optional.</span>
        </div>
        <button
          type="button"
          onClick={handleAddGoal}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Goal
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label="Learning Goals"
      className={cn("space-y-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Learning Goals</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {visibleGoals.length}
          </span>
        </div>
        <button
          type="button"
          onClick={handleAddGoal}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Goal
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleGoals.map((goal) => {
          const isPaused = goal.status === "paused";
          const feasibility = feasibilityByGoalId[goal.id];
          const feasibilityLabel = feasibility ? FEASIBILITY_LABELS[feasibility.status] : undefined;
          const canEvolve = goal.kind !== "deadline";

          return (
            <article
              key={goal.id}
              className={cn(
                "flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors",
                isPaused && "opacity-75",
              )}
            >
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {GOAL_KIND_LABELS[goal.kind]}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-medium",
                      isPaused
                        ? "bg-muted text-muted-foreground"
                        : "bg-muted/70 text-foreground",
                    )}
                  >
                    {isPaused ? "Paused" : "Active"}
                  </span>
                  {feasibilityLabel && (
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[11px] font-medium",
                        feasibility?.status === "at_risk" || feasibility?.status === "infeasible"
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {feasibilityLabel}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground">{goal.title}</h4>
                  {goal.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {goal.description}
                    </p>
                  )}
                </div>

                {(goal.targetDate || goal.dailyMinutesBudget) && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    {goal.targetDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarBlank className="h-3.5 w-3.5" aria-hidden="true" />
                        Target {goal.targetDate}
                      </span>
                    )}
                    {goal.dailyMinutesBudget && (
                      <span>{goal.dailyMinutesBudget}m / day</span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
                <button
                  type="button"
                  onClick={() => void (isPaused ? resumeGoal(goal.id) : pauseGoal(goal.id))}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {isPaused ? (
                    <>
                      <Play className="h-3 w-3" weight="fill" aria-hidden="true" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3" aria-hidden="true" />
                      Pause
                    </>
                  )}
                </button>

                {canEvolve && (
                  <button
                    type="button"
                    onClick={() => handleEvolveGoal(goal)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <TrendUp className="h-3 w-3" aria-hidden="true" />
                    {goal.kind === "exploration" ? "Evolve to structured" : "Add deadline"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void deleteGoal(goal.id)}
                  aria-label={`Delete ${goal.title}`}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Trash className="h-3 w-3" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
