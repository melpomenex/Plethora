/**
 * TutorComposer — the tutoring answer input.
 *
 * The "just explain it" escape hatch is ALWAYS visible next to the send
 * button (ai-socratic-tutoring spec: the learner can stop being questioned
 * at any moment). Both controls disable while a tutor turn is in flight.
 */

import { useI18n } from "../../lib/i18n";

export interface TutorComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onExplain: () => void;
  /** True while a tutor turn is running (buttons disable, input stays usable). */
  disabled?: boolean;
}

export function TutorComposer({ value, onChange, onSubmit, onExplain, disabled }: TutorComposerProps) {
  const { t } = useI18n();
  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="space-y-2" data-tutor-composer="true">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSend) onSubmit();
        }}
        placeholder={t("aiTutor.answerPlaceholder")}
        aria-label={t("aiTutor.answerPlaceholder")}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground"
      />
      <div className="flex gap-2">
        {/* Escape hatch: always visible while the session is active. */}
        <button
          type="button"
          className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground disabled:opacity-50"
          disabled={disabled}
          onClick={onExplain}
        >
          {t("aiTutor.justExplain")}
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-[15px] text-primary-foreground disabled:opacity-50"
          disabled={!canSend}
          onClick={onSubmit}
        >
          {t("aiTutor.send")}
        </button>
      </div>
    </div>
  );
}
