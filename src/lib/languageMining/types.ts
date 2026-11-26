import type { LanguageDraftOrigin } from "../languageSrs";
import type { SourceAnchor } from "../../types/languageLexicon";

export type MiningSourceType = "epub" | "pdf" | "html" | "markdown" | "queue" | "transcript" | "video" | "youtube" | "text";
export type MiningAvailability = "available" | "missing" | "needs-review" | "stale" | "offline" | "failed";

export interface MiningProviderProvenance {
  providerId?: string;
  providerVersion?: string;
  generatedAt: number;
  fromCache: boolean;
}

export interface LanguageMiningPayload {
  payloadVersion: 1;
  profileId?: string;
  lexicalEntryId?: string;
  phraseId?: string;
  sentenceId?: string;
  languageTag?: string;
  sourceType: MiningSourceType;
  sourceId: string;
  documentId?: string;
  text: string;
  sentenceText?: string;
  translatedSentence?: string;
  selectedText?: string;
  reading?: string;
  pos?: string;
  lemma?: string;
  sourceAnchor?: SourceAnchor;
  sourceFingerprint?: string;
  mediaId?: string;
  mediaStartMs?: number;
  mediaEndMs?: number;
  frameTimestampMs?: number;
  frameDataUrl?: string;
  frameAvailable: boolean;
  originalAudioAvailability: MiningAvailability;
  translationAvailability: MiningAvailability;
  analysisAvailability: MiningAvailability;
  context: string;
  provenance: MiningProviderProvenance;
  origin: LanguageDraftOrigin;
}

export interface MiningPayloadInput extends Omit<LanguageMiningPayload, "payloadVersion" | "context" | "frameAvailable" | "provenance"> {
  surroundingContext?: string;
  frameAvailable?: boolean;
  provenance?: Partial<MiningProviderProvenance>;
}
