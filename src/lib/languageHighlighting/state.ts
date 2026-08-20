import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type {
  KnowledgeStateSummary,
  LanguageHighlightSettings,
  VocabularyVisualCue,
  VocabularyVisualTreatment,
} from "./types";

const STATE_SUMMARIES: Record<LanguageKnowledgeState, KnowledgeStateSummary> = {
  new: {
    state: "new",
    label: "New word",
    description: "Not yet encountered in this profile",
    isKnown: false,
    isIgnored: false,
    defaultTreatment: "underline",
    defaultCue: "dotted",
  },
  encountered: {
    state: "encountered",
    label: "Encountered word",
    description: "Seen before, but not yet established",
    isKnown: false,
    isIgnored: false,
    defaultTreatment: "underline",
    defaultCue: "dashed",
  },
  learning: {
    state: "learning",
    label: "Learning word",
    description: "Currently being learned",
    isKnown: false,
    isIgnored: false,
    defaultTreatment: "background",
    defaultCue: "solid",
  },
  familiar: {
    state: "familiar",
    label: "Familiar word",
    description: "Recognized with some confidence",
    isKnown: false,
    isIgnored: false,
    defaultTreatment: "underline",
    defaultCue: "wavy",
  },
  known: {
    state: "known",
    label: "Known word",
    description: "Known by this profile",
    isKnown: true,
    isIgnored: false,
    defaultTreatment: "none",
    defaultCue: "none",
  },
  ignored: {
    state: "ignored",
    label: "Ignored word",
    description: "Excluded from this profile's learning signals",
    isKnown: false,
    isIgnored: true,
    defaultTreatment: "muted",
    defaultCue: "double",
  },
};

export const LANGUAGE_KNOWLEDGE_STATE_ORDER: readonly LanguageKnowledgeState[] = [
  "new",
  "encountered",
  "learning",
  "familiar",
  "known",
  "ignored",
];

export function isLanguageKnowledgeState(value: unknown): value is LanguageKnowledgeState {
  return typeof value === "string" && LANGUAGE_KNOWLEDGE_STATE_ORDER.includes(value as LanguageKnowledgeState);
}

export function summarizeLanguageKnowledgeState(state: LanguageKnowledgeState): KnowledgeStateSummary {
  return { ...STATE_SUMMARIES[state] };
}

export function treatmentForLanguageState(
  state: LanguageKnowledgeState,
  settings: Pick<LanguageHighlightSettings, "mode">,
): { treatment: VocabularyVisualTreatment; cue: VocabularyVisualCue } {
  const summary = STATE_SUMMARIES[state];
  if (settings.mode === "off" || state === "known") {
    return { treatment: "none", cue: "none" };
  }

  if (settings.mode === "minimal") {
    // Minimal keeps the two actionable learning states and ignored words visible.
    if (state === "familiar") return { treatment: "none", cue: "none" };
    if (state === "ignored") return { treatment: "muted", cue: "double" };
    return { treatment: "underline", cue: summary.defaultCue };
  }

  return { treatment: summary.defaultTreatment, cue: summary.defaultCue };
}
