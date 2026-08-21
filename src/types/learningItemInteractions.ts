export interface MultipleChoiceOption {
  id?: string;
  text: string;
  isCorrect?: boolean;
  feedback?: string;
}

export interface ImageOcclusionRegion {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
}

export interface LearningItemInteractionMetadata {
  /** UI surface that created the item (e.g. "dictionary-peek"). */
  origin?: string;
  /** Bounded source sentence/passage preserved as creation context. */
  sentence?: string;
  typedMode?: "exact" | "fuzzy" | "semantic";
  hints?: string[];
  acceptedAnswers?: string[];
  audioQuestionUrl?: string;
  audio_question_url?: string;
  audioAnswerUrl?: string;
  audio_answer_url?: string;
  interactionType?: "ordering" | "matching" | "multiple-choice" | "image-occlusion";
  orderingItems?: string[];
  orderingAnswer?: string[];
  matchingPairs?: Array<{ left: string; right: string }>;
  handwritingEnabled?: boolean;
  multipleChoiceOptions?: Array<string | MultipleChoiceOption>;
  multipleChoiceCorrectOptionId?: string;
  multipleChoiceExplanation?: string;
  imageOcclusionAssetId?: string;
  imageOcclusionRegions?: ImageOcclusionRegion[];
  imageOcclusionPrompt?: string;
  /** Language-learning provenance fields used by explicit vocabulary/phrase drafts. */
  languageDraftKey?: string;
  languageProfileId?: string;
  lexicalEntryId?: string;
  phraseId?: string;
  sentenceId?: string;
  sourceAnchor?: unknown;
  providerId?: string;
  providerVersion?: string;
  languageProvenance?: { profileId?: string; sourceAnchor?: unknown; sourceFingerprint?: string; origin?: string };
}
