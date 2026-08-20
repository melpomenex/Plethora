import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import { languageHighlightCssVariables, languageVocabularyStateClass } from "./cssTokens";
import { summarizeLanguageKnowledgeState, treatmentForLanguageState } from "./state";
import type {
  AnnotationVersions,
  LanguageHighlightSettings,
  LanguageReaderToken,
  VocabularyAnnotation,
} from "./types";

export interface VocabularyStateMap {
  profileId: string;
  lexicalStateVersion: number;
  states: ReadonlyMap<string, LanguageKnowledgeState>;
}

export interface BuildVocabularyAnnotationsInput {
  tokens: readonly LanguageReaderToken[];
  stateMap: VocabularyStateMap | null | undefined;
  settings: LanguageHighlightSettings;
  expectedVersions?: Pick<AnnotationVersions, "analysisVersion" | "lexicalStateVersion">;
}

/**
 * Converts an indexed, analyzed token set into render data. It deliberately
 * emits no work in Off mode and rejects profile/version mismatches so late
 * analysis or state-map results cannot paint a different reader/profile.
 */
export function buildVocabularyAnnotations({
  tokens,
  stateMap,
  settings,
  expectedVersions,
}: BuildVocabularyAnnotationsInput): VocabularyAnnotation[] {
  if (settings.mode === "off" || !stateMap || stateMap.profileId !== settings.profileId) return [];
  if (expectedVersions && stateMap.lexicalStateVersion !== expectedVersions.lexicalStateVersion) return [];

  const annotations: VocabularyAnnotation[] = [];
  for (const token of tokens) {
    if (
      !token.analysisAvailable ||
      token.profileId !== settings.profileId ||
      (expectedVersions && token.analysisVersion !== expectedVersions.analysisVersion) ||
      !canAnnotateAnchor(token.anchor)
    ) {
      continue;
    }
    const state = stateMap.states.get(token.lexicalEntryId);
    if (!state) continue;
    const summary = summarizeLanguageKnowledgeState(state);
    const { treatment, cue } = treatmentForLanguageState(state, settings);
    annotations.push({
      tokenId: token.id,
      profileId: token.profileId,
      lexicalEntryId: token.lexicalEntryId,
      surface: token.surface,
      range: token.range,
      anchor: token.anchor,
      summary,
      treatment,
      cue,
      className: languageVocabularyStateClass(state),
      dataAttributes: { state, lexicalEntryId: token.lexicalEntryId },
      ariaLabel: settings.announceState ? `${token.surface}: ${summary.label}` : undefined,
    });
  }
  return annotations;
}

/** Fixed-PDF ambiguity is the only adapter case that requires a hard gate. */
export function canAnnotateAnchor(anchor: LanguageReaderToken["anchor"]): boolean {
  if (anchor.confidence === "low" || anchor.confidence === "ambiguous" || anchor.confidence === "unsupported") {
    return false;
  }
  if (anchor.kind === "pdf-canonical-word") {
    return anchor.source !== "graphical" && Boolean(anchor.wordId) && anchor.confidenceScore >= 0.9;
  }
  if (anchor.kind === "pdf-reflow-range") return anchor.confidenceScore >= 0.75;
  return anchor.confidenceScore >= 0.5;
}

export { languageHighlightCssVariables };
