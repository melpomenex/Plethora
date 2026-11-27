import React, { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Lightbulb,
  LinkSimple,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  PRACTICE_QUESTION_TYPES,
  type CorePracticeQuestionKind,
  type PracticeAnswerPayload,
  type PracticeEvaluationResult,
  type PracticeQuestionItem,
} from "../../../lib/study-plans/studyMode/practiceEngine";
import type { StudySourceAnchor } from "../../../types/studyMode";
import { formatAnchorLocationLabel } from "../../../lib/study-plans/studyMode/anchoring";

export interface PracticePanelProps {
  activeQuestion: PracticeQuestionItem | null;
  lastEvaluation: PracticeEvaluationResult | null;
  sessionEvaluations: PracticeEvaluationResult[];
  targetDifficulty: number;
  isGenerating: boolean;
  isSubmitting: boolean;
  onCancelGenerate: () => void;
  onGenerateQuestion: (kind: CorePracticeQuestionKind) => void;
  onSubmitAnswer: (payload: PracticeAnswerPayload) => void;
  onInspectAnchor: (anchor: StudySourceAnchor) => void;
  onRequestWorkedExample: () => void;
  onOpenTutor?: (prompt?: string) => void;
  onPromoteFlashcard?: (prompt: string, explanation: string) => void;
  initialDraftAnswer?: string | null;
  onDraftAnswerChange?: (draft: string) => void;
}

export const PracticePanel: React.FC<PracticePanelProps> = ({
  activeQuestion,
  lastEvaluation,
  sessionEvaluations,
  targetDifficulty,
  isGenerating,
  isSubmitting,
  onCancelGenerate,
  onGenerateQuestion,
  onSubmitAnswer,
  onInspectAnchor,
  onRequestWorkedExample,
  onOpenTutor,
  onPromoteFlashcard,
  initialDraftAnswer,
  onDraftAnswerChange,
}) => {
  const [selectedKind, setSelectedKind] = useState<CorePracticeQuestionKind>("multiple_choice");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [writtenText, setWrittenText] = useState(initialDraftAnswer ?? "");
  const [blankAnswers, setBlankAnswers] = useState<string[]>([]);
  const [orderedItems, setOrderedItems] = useState<string[]>([]);
  const [hintRevealed, setHintRevealed] = useState(false);

  // Reset local answer inputs when active question changes
  useEffect(() => {
    setSelectedOption(null);
    setWrittenText(initialDraftAnswer ?? "");
    setHintRevealed(false);
    if (activeQuestion?.questionKind === "fill_blank") {
      const count = Math.max(1, activeQuestion.expectedBlanks?.length ?? 1);
      setBlankAnswers(Array.from({ length: count }, () => ""));
    } else {
      setBlankAnswers([]);
    }
    if (activeQuestion?.questionKind === "ordering") {
      setOrderedItems([...(activeQuestion.orderingItems ?? [])]);
    } else {
      setOrderedItems([]);
    }
  }, [activeQuestion?.id]);

  const handleWrittenTextChange = (value: string) => {
    setWrittenText(value);
    onDraftAnswerChange?.(value);
  };

  const moveOrderingItem = (index: number, delta: -1 | 1) => {
    setOrderedItems((prev) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const canSubmit = (() => {
    if (!activeQuestion || isSubmitting) return false;
    switch (activeQuestion.questionKind) {
      case "multiple_choice":
        return selectedOption !== null;
      case "fill_blank":
        return blankAnswers.some((b) => b.trim().length > 0);
      case "ordering":
        return orderedItems.length > 0;
      default:
        return writtenText.trim().length > 0;
    }
  })();

  const handleSubmit = () => {
    if (!activeQuestion || !canSubmit) return;
    onSubmitAnswer({
      selectedIndex: activeQuestion.questionKind === "multiple_choice" ? selectedOption : null,
      writtenText:
        activeQuestion.questionKind === "free_recall" ||
        activeQuestion.questionKind === "scenario_error"
          ? writtenText
          : null,
      blankAnswers: activeQuestion.questionKind === "fill_blank" ? blankAnswers : null,
      orderedItems: activeQuestion.questionKind === "ordering" ? orderedItems : null,
      usedHint: hintRevealed,
    });
  };

  const understoodCount = sessionEvaluations.filter((e) => e.outcome === "understood").length;

  return (
    <div className="space-y-4">
      {/* Adaptive Session Progress Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">Adaptive Practice</span>
          <span
            data-testid="practice-difficulty-badge"
            className="px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium"
          >
            Difficulty {targetDifficulty}/5
          </span>
        </div>
        <div className="text-muted-foreground">
          {sessionEvaluations.length > 0
            ? `${understoodCount}/${sessionEvaluations.length} understood`
            : "Ready for first check"}
        </div>
      </div>

      {/* Question Type Selector & Generator Controls */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Question format">
          {PRACTICE_QUESTION_TYPES.map((qt) => (
            <button
              key={qt.kind}
              type="button"
              aria-pressed={selectedKind === qt.kind}
              onClick={() => setSelectedKind(qt.kind)}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                selectedKind === qt.kind
                  ? "border-primary bg-primary/15 text-foreground font-medium"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {qt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerateQuestion(selectedKind)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-60 hover:opacity-90"
          >
            <Sparkle className="w-3.5 h-3.5" aria-hidden="true" />
            {isGenerating ? "Generating Question..." : "Next Adaptive Question"}
          </button>
          {isGenerating && (
            <button
              type="button"
              onClick={onCancelGenerate}
              className="px-2.5 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-destructive"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Active Question Card */}
      {activeQuestion && (
        <div
          data-testid="practice-question-card"
          className="rounded-lg border border-border bg-card p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wide font-medium">
              {activeQuestion.questionKind.replace(/_/g, " ")} · Level {activeQuestion.difficulty}/5
            </span>
            {activeQuestion.hint && !hintRevealed && (
              <button
                type="button"
                onClick={() => setHintRevealed(true)}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                Show Hint
              </button>
            )}
          </div>

          {activeQuestion.scenarioText && (
            <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed">
              {activeQuestion.scenarioText}
            </div>
          )}

          <p className="text-sm font-medium leading-snug">{activeQuestion.prompt}</p>

          {hintRevealed && activeQuestion.hint && (
            <div
              data-testid="practice-hint-box"
              className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-foreground"
            >
              <strong className="text-primary mr-1">Hint:</strong>
              {activeQuestion.hint}
            </div>
          )}

          {/* Multiple Choice */}
          {activeQuestion.questionKind === "multiple_choice" && activeQuestion.options && (
            <div className="space-y-2">
              {activeQuestion.options.map((opt, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-2 text-xs p-2.5 rounded-md border border-border cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name={`q-${activeQuestion.id}`}
                    checked={selectedOption === idx}
                    onChange={() => setSelectedOption(idx)}
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
          )}

          {/* Fill in the Blank */}
          {activeQuestion.questionKind === "fill_blank" && (
            <div className="space-y-2">
              {blankAnswers.map((val, idx) => (
                <label key={idx} className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">Blank {idx + 1}</span>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) =>
                      setBlankAnswers((prev) =>
                        prev.map((item, i) => (i === idx ? e.target.value : item))
                      )
                    }
                    placeholder="Type the missing term..."
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Ordering / Sequencing */}
          {activeQuestion.questionKind === "ordering" && (
            <ol className="space-y-1.5" aria-label="Arrange steps in order">
              {orderedItems.map((item, idx) => (
                <li
                  key={`${item}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs"
                >
                  <span>
                    <strong className="mr-1.5 text-muted-foreground">{idx + 1}.</strong>
                    {item}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      aria-label={`Move step ${idx + 1} up`}
                      onClick={() => moveOrderingItem(idx, -1)}
                      className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                    >
                      <ArrowUp className="w-3 h-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === orderedItems.length - 1}
                      aria-label={`Move step ${idx + 1} down`}
                      onClick={() => moveOrderingItem(idx, 1)}
                      className="p-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
                    >
                      <ArrowDown className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* Free Recall / Scenario Error */}
          {(activeQuestion.questionKind === "free_recall" ||
            activeQuestion.questionKind === "scenario_error") && (
            <textarea
              rows={3}
              value={writtenText}
              onChange={(e) => handleWrittenTextChange(e.target.value)}
              placeholder={
                activeQuestion.questionKind === "scenario_error"
                  ? "Identify the conceptual error and explain why it is flawed..."
                  : "Explain the concept in your own words..."
              }
              className="w-full rounded-md border border-border bg-background p-2.5 text-xs"
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50"
            >
              {isSubmitting ? "Checking..." : "Check Understanding"}
            </button>

            {activeQuestion.anchors.length > 0 && (
              <button
                type="button"
                onClick={() => onInspectAnchor(activeQuestion.anchors[0])}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <LinkSimple className="w-3 h-3" aria-hidden="true" />
                {formatAnchorLocationLabel(activeQuestion.anchors[0])}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Evaluation & Actionable Misconception Feedback */}
      {lastEvaluation && (
        <div
          data-testid="practice-evaluation-feedback"
          className="rounded-lg border border-border bg-card p-4 space-y-3 text-xs"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {lastEvaluation.outcome === "understood" ? (
              <CheckCircle className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            ) : (
              <WarningCircle className="w-4 h-4 text-destructive shrink-0" aria-hidden="true" />
            )}
            <span>
              Result: {lastEvaluation.outcome} (Score: {Math.round(lastEvaluation.score * 100)}%)
            </span>
          </div>

          <p className="leading-relaxed">{lastEvaluation.feedback}</p>

          {lastEvaluation.misconceptionDetected && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-foreground">
              <strong className="text-destructive mr-1">Misconception detected:</strong>
              {lastEvaluation.misconceptionDetected}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => onGenerateQuestion(selectedKind)}
              className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
            >
              Continue Practice
            </button>
            {lastEvaluation.outcome !== "understood" && (
              <button
                type="button"
                onClick={onRequestWorkedExample}
                className="px-2.5 py-1 rounded-md border border-border hover:bg-muted"
              >
                Show Worked Example
              </button>
            )}
            {onOpenTutor && lastEvaluation.outcome !== "understood" && (
              <button
                type="button"
                onClick={() =>
                  onOpenTutor(
                    `Explain why my answer was wrong on: "${activeQuestion?.prompt ?? ""}"`
                  )
                }
                className="px-2.5 py-1 rounded-md border border-border hover:bg-muted"
              >
                Ask Tutor Why
              </button>
            )}
            {onPromoteFlashcard && activeQuestion && (
              <button
                type="button"
                onClick={() => onPromoteFlashcard(activeQuestion.prompt, lastEvaluation.feedback)}
                className="px-2.5 py-1 rounded-md border border-border hover:bg-muted"
              >
                Promote to Flashcard
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
