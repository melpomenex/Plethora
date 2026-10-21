import type { SectionSourceReference } from "../../../utils/sectionIndex";
import type { ImageOcclusionRegion, MultipleChoiceOption } from "../../../types/learningItemInteractions";
import type { SessionSourceEvidence } from "../../../types/recordingSession";

export type DraftCardType = "qa" | "cloze" | "multiple-choice" | "image-occlusion";

export interface DraftCard {
  id: string;
  type: DraftCardType;
  question?: string;
  answer?: string;
  text?: string;
  multipleChoiceOptions?: MultipleChoiceOption[];
  multipleChoiceCorrectOptionId?: string;
  imageOcclusionAssetId?: string;
  imageOcclusionRegions?: ImageOcclusionRegion[];
  selected: boolean;
  sourceMessageId?: string;
  createdAt: number;
  isEditing?: boolean;
  tags: string[];
  /** Parent extract retained when a draft is created from an extract. */
  extractId?: string;
  /** If true, this card was already persisted to the DB (e.g. via generateLearningItemsFromExtract)
   *  and should NOT be re-created by handleSaveSelected. */
  alreadyPersisted?: boolean;
  /** The DB id of the already-persisted learning item (if alreadyPersisted). */
  persistedItemId?: string;
  /** Section provenance when the card was generated from a `#` section focus. */
  sourceContext?: SectionSourceReference;
  /** Optional durable session draft evidence (Task 4.2). */
  sessionEvidence?: SessionSourceEvidence;
  /** Optional durable draft ID in SQLite (Task 4.2). */
  durableDraftId?: string;
  /** Optional revision for CAS concurrency (Task 4.2). */
  durableRevision?: number;
}
