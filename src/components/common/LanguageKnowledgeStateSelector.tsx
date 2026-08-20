import { useState } from "react";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import { LANGUAGE_KNOWLEDGE_STATES } from "../../api/languageKnowledge";

const labels: Record<LanguageKnowledgeState, string> = {
  new: "New",
  encountered: "Encountered",
  learning: "Learning",
  familiar: "Familiar",
  known: "Known",
  ignored: "Ignored",
};

export interface LanguageKnowledgeStateSelectorProps {
  value: LanguageKnowledgeState;
  onChange: (state: LanguageKnowledgeState) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}

/** Accessible state control; memorization is intentionally a separate action. */
export function LanguageKnowledgeStateSelector({ value, onChange, disabled = false, label = "Language knowledge state" }: LanguageKnowledgeStateSelectorProps) {
  const [pending, setPending] = useState(false);
  return (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled || pending}
        onChange={async (event) => {
          setPending(true);
          try { await onChange(event.target.value as LanguageKnowledgeState); } finally { setPending(false); }
        }}
      >
        {LANGUAGE_KNOWLEDGE_STATES.map((state) => <option key={state} value={state}>{labels[state]}</option>)}
      </select>
      <small aria-live="polite">Changing state does not create a review card.</small>
    </label>
  );
}
