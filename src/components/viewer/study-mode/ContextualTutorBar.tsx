import React from "react";
import { ChatCircleDots } from "@phosphor-icons/react";
import {
  CONTEXTUAL_TUTOR_PROMPTS,
  type ContextualTutorPromptOption,
} from "../../../lib/study-plans/studyMode/contextualTutor";

export interface ContextualTutorBarProps {
  hasRecentWrongAnswer: boolean;
  isOffline?: boolean;
  onLaunchTutor: (prompt: ContextualTutorPromptOption) => void;
}

export const ContextualTutorBar: React.FC<ContextualTutorBarProps> = ({
  hasRecentWrongAnswer,
  isOffline = false,
  onLaunchTutor,
}) => {
  return (
    <section
      aria-label="Contextual AI Tutor"
      data-testid="contextual-tutor-bar"
      className="rounded-lg border border-border bg-card/70 p-3 space-y-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <ChatCircleDots className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span>Ask Contextual Tutor</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {isOffline ? "Offline" : "Grounded in active source & evidence"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CONTEXTUAL_TUTOR_PROMPTS.map((opt) => {
          const highlightWrong = opt.requiresWrongAnswer && hasRecentWrongAnswer;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onLaunchTutor(opt)}
              className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                highlightWrong
                  ? "border-destructive/40 bg-destructive/10 text-destructive font-medium hover:bg-destructive/15"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
};
