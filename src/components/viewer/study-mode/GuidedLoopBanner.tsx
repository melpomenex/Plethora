import React from "react";
import {
  ArrowRight,
  CheckCircle,
  Compass,
  Lightbulb,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  GUIDED_STAGE_LABELS,
  GUIDED_STAGE_ORDER,
  getCurrentGuidedObjective,
  type GuidedLoopState,
} from "../../../lib/study-plans/studyMode/guidedLoop";

export interface GuidedLoopBannerProps {
  state: GuidedLoopState;
  onExitGuided: () => void;
  onAdvanceStage: () => void;
  onJumpToAnchor: () => void;
  onGenerateExplanation: (style?: "explanation" | "worked_example") => void;
  onStartRecallCheck: () => void;
  onPromoteFlashcard?: () => void;
}

export const GuidedLoopBanner: React.FC<GuidedLoopBannerProps> = ({
  state,
  onExitGuided,
  onAdvanceStage,
  onJumpToAnchor,
  onGenerateExplanation,
  onStartRecallCheck,
  onPromoteFlashcard,
}) => {
  if (state.mode !== "guided") return null;

  const currentObj = getCurrentGuidedObjective(state);
  const total = Math.max(1, state.objectives.length);
  const currentNum = Math.min(state.currentIndex + 1, total);

  return (
    <section
      aria-label="Guided Study Session"
      data-testid="guided-loop-banner"
      className="rounded-lg border border-primary/35 bg-primary/5 p-3 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground min-w-0">
          <Compass className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span className="truncate">
            Guided Session · Objective {currentNum}/{total}
          </span>
        </div>
        <button
          type="button"
          onClick={onExitGuided}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          Switch to Freeform
        </button>
      </div>

      {/* Stage Stepper */}
      <div className="flex flex-wrap gap-1" role="list" aria-label="Guided stages">
        {GUIDED_STAGE_ORDER.map((stage) => {
          const active = state.stage === stage;
          return (
            <span
              key={stage}
              role="listitem"
              aria-current={active ? "step" : undefined}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {GUIDED_STAGE_LABELS[stage]}
            </span>
          );
        })}
      </div>

      {/* Stage-specific guidance */}
      {state.stage === "introduce" && (
        <div className="space-y-2">
          <p className="text-foreground">
            <strong>Learning Objective:</strong>{" "}
            {currentObj?.label ?? "Core concept from current passage"}
          </p>
          <button
            type="button"
            onClick={() => {
              onJumpToAnchor();
              onAdvanceStage();
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
          >
            Jump to Anchored Passage
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {state.stage === "anchor" && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Read the highlighted source passage in the center pane, then build understanding.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onJumpToAnchor}
              className="px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
            >
              Highlight Source Anchor
            </button>
            <button
              type="button"
              onClick={() => {
                onAdvanceStage();
                onGenerateExplanation("explanation");
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
            >
              <Sparkle className="w-3.5 h-3.5" aria-hidden="true" />
              Build Understanding
            </button>
          </div>
        </div>
      )}

      {state.stage === "understand" && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Review the explanation or request a worked example, then test your recall.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onGenerateExplanation("worked_example")}
              className="px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
            >
              Show Worked Example
            </button>
            <button
              type="button"
              onClick={() => {
                onAdvanceStage();
                onStartRecallCheck();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
            >
              Test Recall &amp; Apply
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {state.stage === "recall" && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Answer the active recall check in Practice to verify your understanding.
          </p>
          <button
            type="button"
            onClick={onStartRecallCheck}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
          >
            Open Recall Check
          </button>
        </div>
      )}

      {state.stage === "adapt" && (
        <div className="space-y-2">
          <div className="flex items-start gap-1.5 text-foreground">
            <WarningCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <strong>Needs Practice:</strong>{" "}
              {state.lastMisconception ??
                "Let's approach this concept from a different angle before reassessing."}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onGenerateExplanation("worked_example")}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
            >
              <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
              Re-explain with Worked Example
            </button>
            <button
              type="button"
              onClick={() => {
                onAdvanceStage();
                onStartRecallCheck();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
            >
              Reassess with Fresh Question
            </button>
          </div>
        </div>
      )}

      {state.stage === "reinforce" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-foreground font-medium">
            <CheckCircle className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <span>Understanding demonstrated! Optionally schedule spaced retention.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {onPromoteFlashcard && (
              <button
                type="button"
                onClick={onPromoteFlashcard}
                className="px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted"
              >
                Create FSRS Flashcard (Optional)
              </button>
            )}
            <button
              type="button"
              onClick={onAdvanceStage}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
            >
              {state.currentIndex + 1 < total ? "Next Objective" : "View Session Recap"}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {state.stage === "recap" && (
        <div className="space-y-2" data-testid="guided-loop-recap">
          <div className="font-semibold text-foreground">Guided Session Recap</div>
          <p className="text-muted-foreground">
            Understood: {state.understoodObjectiveIds.length} · Needs practice:{" "}
            {state.needsPracticeObjectiveIds.length} · Flashcards promoted:{" "}
            {state.promotedFlashcardCount}
          </p>
          <button
            type="button"
            onClick={onExitGuided}
            className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
          >
            Finish &amp; Return to Freeform
          </button>
        </div>
      )}
    </section>
  );
};
