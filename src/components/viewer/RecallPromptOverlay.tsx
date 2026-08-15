/**
 * RecallPromptOverlay — the active-recall prompt card (task 5.5, design D19
 * / ai-active-recall "Recall loop with feedback").
 *
 * A dismissible overlay rendered as a SIBLING of the reading surface (never
 * a modal over the reader, never a navigation), so answering or dismissing
 * continues reading at the exact prior position. Shows the question, an
 * answer input, immediate AI feedback after submit, "not today"
 * (day-scoped dismissal), and "keep this question" (promotion into the
 * Learn-this preview flow — only acceptance there creates a card).
 */

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, BookmarkSimple, Sparkle, X } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";
import type { ActiveRecallPrompt } from "./useRecallPrompts";

export interface RecallPromptOverlayProps {
  open: boolean;
  prompt: ActiveRecallPrompt | null;
  phase: "idle" | "prompt" | "assessing" | "feedback";
  assessment: AnswerAssessment | null;
  assessmentError: string | null;
  onSubmitAnswer: (answer: string) => void;
  onDismiss: () => void;
  onNotToday: () => void;
  onKeep: () => void;
}

const CLASSIFICATION_TONE: Record<string, string> = {
  correct: "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  incorrect: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  misconception: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

export function RecallPromptOverlay({
  open,
  prompt,
  phase,
  assessment,
  assessmentError,
  onSubmitAnswer,
  onDismiss,
  onNotToday,
  onKeep,
}: RecallPromptOverlayProps) {
  const { t } = useI18n();
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Fresh prompt → fresh input.
  useEffect(() => {
    if (open) setAnswer("");
  }, [open, prompt?.promptId]);

  if (!open || !prompt) return null;

  const showFeedback = phase === "feedback";
  const busy = phase === "assessing";

  return (
    <div
      data-recall-overlay="true"
      role="dialog"
      aria-label={t("aiRecall.title")}
      className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-lg rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 md:inset-x-auto md:right-6 md:bottom-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkle className="h-4 w-4" aria-hidden="true" />
          {t("aiRecall.title")}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          data-recall-dismiss=""
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("common.close")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <p className="mt-2 text-[15px] font-medium leading-snug text-foreground" data-recall-question="">
        {prompt.question}
      </p>

      {!showFeedback ? (
        <>
          <textarea
            ref={inputRef}
            rows={2}
            value={answer}
            disabled={busy}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t("aiRecall.answerPlaceholder")}
            data-recall-answer-input=""
            className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || answer.trim().length === 0}
              onClick={() => onSubmitAnswer(answer.trim())}
              data-recall-submit=""
              className="min-h-[44px] flex-1 rounded-xl bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? t("aiRecall.checking") : t("aiRecall.submit")}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-[44px] flex-1 rounded-xl border border-border px-4 py-2 text-[14px] text-foreground"
            >
              {t("aiRecall.skip")}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-2" data-recall-feedback="">
          {assessment ? (
            <>
              <div
                data-recall-classification={assessment.classification}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  CLASSIFICATION_TONE[assessment.classification] ?? CLASSIFICATION_TONE.partial
                }`}
              >
                {t(`aiRecall.classification.${assessment.classification}`)}
              </div>
              <p className="text-[14px] leading-snug text-foreground">{assessment.feedback}</p>
              {assessment.misconception && (
                <p className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-2 text-[13px] text-foreground">
                  <span className="font-semibold">{t("aiRecall.misconception")}: </span>
                  {assessment.misconception}
                  {assessment.suggestedCorrection ? (
                    <>
                      {" "}
                      <span className="italic">{assessment.suggestedCorrection}</span>
                    </>
                  ) : null}
                </p>
              )}
              {assessment.missingConcepts.length > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  {t("aiRecall.missingConcepts", {
                    concepts: assessment.missingConcepts.join(", "),
                  })}
                </p>
              )}
              <p className="rounded-lg bg-muted/60 p-2 text-[13px] text-foreground">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("aiRecall.expectedAnswer")}:{" "}
                </span>
                {prompt.expectedAnswer}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("aiRecall.feedbackUnavailable")}</p>
          )}
          {assessmentError && (
            <p className="text-[12px] text-muted-foreground" data-recall-assessment-error="">
              {assessmentError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onDismiss}
              data-recall-continue=""
              className="min-h-[44px] flex-1 rounded-xl bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground inline-flex items-center justify-center gap-1.5"
            >
              <ArrowCounterClockwise className="h-4 w-4" aria-hidden="true" />
              {t("aiRecall.continue")}
            </button>
            <button
              type="button"
              onClick={onKeep}
              data-recall-keep=""
              className="min-h-[44px] flex-1 rounded-xl border border-border px-4 py-2 text-[14px] text-foreground inline-flex items-center justify-center gap-1.5"
            >
              <BookmarkSimple className="h-4 w-4" aria-hidden="true" />
              {t("aiRecall.keep")}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onNotToday}
        data-recall-not-today=""
        className="mt-2 w-full text-center text-[12px] text-muted-foreground hover:underline"
      >
        {t("aiRecall.notToday")}
      </button>
    </div>
  );
}
