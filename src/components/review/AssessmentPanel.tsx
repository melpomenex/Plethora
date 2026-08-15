/**
 * Free-response answer assessment UI (task 5.8, design D20 /
 * ai-answer-assessment + flashcard-review-session specs).
 *
 * `FreeResponseInput` — the optional, skippable answer box shown BEFORE the
 * card is revealed (only when `aiAnswerAssessment` is on AND an
 * assessment-capable provider is available; otherwise nothing renders and
 * the review flow is byte-for-byte the pre-feature experience).
 *
 * `AssessmentPanel` — the structured assessment displayed BESIDE the
 * revealed answer: classification badge, missing concepts, feedback, and a
 * misconception callout. Purely informational: the grade buttons stay the
 * standard ones and scheduling is untouched.
 */

import { useI18n } from "../../lib/i18n";
import { Sparkle, Warning } from "@phosphor-icons/react";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";

export interface FreeResponseInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function FreeResponseInput({ value, onChange, disabled }: FreeResponseInputProps) {
  const { t } = useI18n();
  return (
    <div className="mt-4 pt-3 border-t border-border/60" data-free-response-input="">
      <label
        htmlFor="free-response-answer"
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {t("aiRecall.freeResponseLabel")}
      </label>
      <textarea
        id="free-response-answer"
        rows={2}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("aiRecall.freeResponsePlaceholder")}
        data-free-response-field=""
        className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
      />
    </div>
  );
}

const CLASSIFICATION_TONE: Record<string, string> = {
  correct: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
  partial: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  incorrect: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
  misconception: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

export interface AssessmentPanelProps {
  assessment: AnswerAssessment | null;
  /** Set when the assessment run failed — the review continues regardless. */
  error?: string | null;
  /** True while the assessment is running after reveal. */
  pending?: boolean;
}

export function AssessmentPanel({ assessment, error, pending }: AssessmentPanelProps) {
  const { t } = useI18n();
  if (pending) {
    return (
      <div
        data-assessment-panel=""
        data-assessment-state="pending"
        className="mt-4 pt-3 border-t border-border/60 text-sm text-muted-foreground"
      >
        {t("aiRecall.checking")}
      </div>
    );
  }
  if (!assessment) {
    if (error) {
      return (
        <div
          data-assessment-panel=""
          data-assessment-state="error"
          className="mt-4 pt-3 border-t border-border/60 text-sm text-muted-foreground"
        >
          {t("aiRecall.feedbackUnavailable")}
        </div>
      );
    }
    return null;
  }

  return (
    <div
      data-assessment-panel=""
      data-assessment-state="done"
      data-assessment-classification={assessment.classification}
      className="mt-4 pt-3 border-t border-border/60"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            CLASSIFICATION_TONE[assessment.classification] ?? CLASSIFICATION_TONE.partial
          }`}
        >
          <Sparkle className="h-3 w-3" aria-hidden="true" />
          {t(`aiRecall.classification.${assessment.classification}`)}
        </span>
        <span className="text-xs text-muted-foreground">{t("aiRecall.assessmentTitle")}</span>
      </div>

      {assessment.misconception && (
        <div className="mt-2 rounded-lg border border-purple-500/30 bg-purple-500/10 p-2.5 text-sm text-foreground">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">
            <Warning className="h-3.5 w-3.5" aria-hidden="true" />
            {t("aiRecall.misconception")}
          </div>
          <p>{assessment.misconception}</p>
          {assessment.suggestedCorrection && (
            <p className="mt-1 italic text-muted-foreground">{assessment.suggestedCorrection}</p>
          )}
        </div>
      )}

      <p className="mt-2 text-sm leading-snug text-foreground">{assessment.feedback}</p>

      {assessment.missingConcepts.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("aiRecall.missingConcepts", { concepts: assessment.missingConcepts.join(", ") })}
        </p>
      )}
    </div>
  );
}
