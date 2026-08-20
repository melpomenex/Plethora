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
  sourceType: MiningSourceType;
  sourceId: string;
  documentId?: string;
  text: string;
  sentenceText?: string;
  selectedText?: string;
  sourceAnchor?: SourceAnchor;
  sourceFingerprint?: string;
  mediaId?: string;
  mediaStartMs?: number;
  mediaEndMs?: number;
  frameTimestampMs?: number;
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
