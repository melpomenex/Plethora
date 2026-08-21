import { rankLanguageRecommendations, type RankedRecommendation, type RecommendationCandidate } from "../languageRecommendations";
import type { LanguageHostActionDetail, LanguageHostSource } from "../languageHost";
import type { SourceAnchor } from "../../types/languageLexicon";

export const LANGUAGE_PRACTICE_RECOMMENDATION_EVENT = "plethora-language-practice-recommendation";

export interface LanguagePracticeRecommendationDetail {
  candidate: RankedRecommendation;
  hostId: string;
  source: LanguageHostSource;
  sourceAnchor: SourceAnchor;
  profileId: string;
  languageTag: string;
  origin: LanguageHostActionDetail["origin"];
}

export function dispatchLanguagePracticeRecommendation(detail: LanguagePracticeRecommendationDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LanguagePracticeRecommendationDetail>(LANGUAGE_PRACTICE_RECOMMENDATION_EVENT, { detail }));
}

export function selectLanguagePracticeRecommendation(input: {
  candidates: readonly RecommendationCandidate[];
  interests: readonly string[];
  now?: number;
}): RankedRecommendation | null {
  return rankLanguageRecommendations(input.candidates, input.interests, input.now)[0] ?? null;
}

/** Producer used by host surfaces: ranking and duplicate suppression happen before any preview is shown. */
export function dispatchTopLanguagePracticeRecommendation(input: {
  candidates: readonly RecommendationCandidate[];
  interests: readonly string[];
  detail: Omit<LanguagePracticeRecommendationDetail, "candidate">;
  now?: number;
}): RankedRecommendation | null {
  const candidate = selectLanguagePracticeRecommendation(input);
  if (!candidate) return null;
  dispatchLanguagePracticeRecommendation({ ...input.detail, candidate });
  return candidate;
}
