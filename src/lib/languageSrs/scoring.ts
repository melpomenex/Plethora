import type { LanguageLearningDraft, LanguageSuggestionInput, LanguageSuggestionScore } from "./types";

const SUGGESTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** Explainable, bounded suggestion score. It never creates or mutates a card. */
export function scoreLanguageSuggestion(input: LanguageSuggestionInput): LanguageSuggestionScore {
  const now = input.now ?? Date.now();
  const reasons: string[] = [];
  if (input.state === "ignored" || input.state === "known") return { eligible: false, score: 0, reasons: ["state-excluded"] };
  if (input.lastSuggestedAt !== undefined && now - input.lastSuggestedAt < SUGGESTION_COOLDOWN_MS) {
    return { eligible: false, score: 0, reasons: ["cooldown"], cooldownUntil: input.lastSuggestedAt + SUGGESTION_COOLDOWN_MS };
  }
  const encounterSignal = Math.min(1, Math.max(0, input.encounterCount / 5));
  const passiveSignal = Math.min(1, Math.max(0, input.passiveEvidence / 5));
  const activePenalty = Math.min(1, Math.max(0, input.activeEvidence / 3));
  if (encounterSignal > 0) reasons.push("repeated-encounters");
  if (passiveSignal > 0) reasons.push("passive-evidence");
  if (input.lookupCount > 0) reasons.push("looked-up");
  const score = Math.max(0, Math.min(1, encounterSignal * 0.45 + passiveSignal * 0.35 + Math.min(1, input.lookupCount / 3) * 0.2 - activePenalty * 0.25));
  return { eligible: score > 0, score, reasons };
}

export function createLanguageLearningDraft(input: Omit<LanguageLearningDraft, "draftKey"> & { draftKey?: string }): LanguageLearningDraft {
  return {
    ...input,
    draftKey: input.draftKey ?? [input.provenance.profileId, input.provenance.lexicalEntryId ?? "-", input.provenance.phraseId ?? "-", input.itemType, input.question.trim().toLocaleLowerCase()].join("\u001f"),
  };
}
