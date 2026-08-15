/**
 * TutorTurnBubble — one transcript entry of the tutoring conversation.
 *
 * Tutor turns are styled distinctly from user turns (left-aligned panel with
 * a move chip vs. right-aligned primary bubble) and carry the move-type
 * affordances: the move label, hint-level pips for `hint` turns, and a stuck
 * indicator when the state machine reported escalation.
 */

import { useI18n } from "../../lib/i18n";
import type { TutorTranscriptTurn } from "../../lib/ai/tutor/session";

const HINT_PIPS = [1, 2, 3] as const;

export function TutorTurnBubble({ turn }: { turn: TutorTranscriptTurn }) {
  const { t } = useI18n();

  if (turn.role === "user") {
    return (
      <div className="flex justify-end" data-tutor-role="user">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-relaxed text-primary-foreground whitespace-pre-wrap">
          {turn.text}
        </p>
      </div>
    );
  }

  const isHint = turn.move === "hint";
  return (
    <div className="flex flex-col items-start gap-1" data-tutor-role="tutor" data-tutor-move={turn.move}>
      <div className="flex items-center gap-1.5">
        <span
          className={`text-[11px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 ${
            turn.move === "wrap-up"
              ? "bg-success/15 text-success"
              : turn.move === "explain"
                ? "bg-accent/15 text-accent-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {t(`aiTutor.move.${turn.move ?? "question"}`)}
        </span>
        {isHint && (
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={t("aiTutor.hintLevel", { level: turn.hintLevel ?? 0 })}
            data-tutor-hint-level={turn.hintLevel ?? 0}
          >
            {HINT_PIPS.map((pip) => (
              <span
                key={pip}
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  pip <= (turn.hintLevel ?? 0) ? "bg-amber-500" : "bg-border"
                }`}
              />
            ))}
          </span>
        )}
      </div>
      <p className="max-w-[95%] rounded-2xl rounded-bl-md border border-border bg-background px-3.5 py-2 text-[14px] leading-relaxed text-foreground whitespace-pre-wrap">
        {turn.text}
      </p>
      {turn.stuckDetected && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400" data-tutor-stuck="true">
          {t("aiTutor.stuck")}
        </p>
      )}
    </div>
  );
}
