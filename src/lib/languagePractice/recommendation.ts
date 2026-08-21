import type { RankedRecommendation } from "../languageRecommendations";
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
