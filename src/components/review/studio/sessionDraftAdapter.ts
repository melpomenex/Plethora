import type {
  AcceptSessionDraftSpec,
  AcceptSessionDraftsInput,
  PersistedSessionLearningDraft,
  SessionSourceEvidence,
  UpdateSessionLearningDraft,
} from "../../../types/recordingSession";
import type { DraftCard, DraftCardType } from "./types";

export interface SessionExtractDraft {
  id: string;
  sessionId: string;
  revision: number;
  verbatimText: string;
  summaryNote?: string;
  conceptKey?: string | null;
  evidence?: SessionSourceEvidence;
  status: "proposed" | "rejected" | "accepted" | "superseded";
  selected: boolean;
  duplicateJson?: string | null;
  acceptedTargetId?: string | null;
  createdAt: number;
}

/**
 * Safely parses JSON string or returns fallback.
 */
function safeJsonParse<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

/**
 * Maps a persisted SQLite session learning draft into a Flashcard Studio DraftCard.
 */
export function persistedDraftToStudioCard(
  draft: PersistedSessionLearningDraft
): DraftCard {
  const payload = safeJsonParse<{
    kind?: string;
    candidate?: {
      cardType?: string;
      question?: string;
      answer?: string;
      text?: string;
      multipleChoiceOptions?: { id: string; text: string }[];
      multipleChoiceCorrectOptionId?: string;
      concept?: string;
      evidenceQuote?: string;
    };
  }>(draft.payloadJson, {});

  const candidate = payload.candidate || {};
  const evidence = safeJsonParse<SessionSourceEvidence | undefined>(
    draft.evidenceJson,
    undefined
  );

  let cardType: DraftCardType = "qa";
  if (
    candidate.cardType === "cloze" ||
    candidate.cardType === "multiple-choice" ||
    candidate.cardType === "image-occlusion"
  ) {
    cardType = candidate.cardType;
  }

  const tags: string[] = [];
  if (draft.conceptKey) {
    tags.push(draft.conceptKey);
  } else if (candidate.concept) {
    tags.push(candidate.concept);
  }

  return {
    id: draft.id,
    type: cardType,
    question: candidate.question,
    answer: candidate.answer,
    text: candidate.text || (cardType === "cloze" ? candidate.question || candidate.evidenceQuote : undefined),
    multipleChoiceOptions: candidate.multipleChoiceOptions,
    multipleChoiceCorrectOptionId: candidate.multipleChoiceCorrectOptionId,
    selected: draft.status === "proposed",
    createdAt: new Date(draft.createdAt).getTime() || Date.now(),
    tags,
    sessionEvidence: evidence,
    durableDraftId: draft.id,
    durableRevision: draft.revision,
    alreadyPersisted: draft.status === "accepted",
    persistedItemId: draft.acceptedTargetId || undefined,
  };
}

/**
 * Maps an edited Flashcard Studio DraftCard back into an UpdateSessionLearningDraft payload.
 */
export function studioCardToPersistedUpdate(
  card: DraftCard
): UpdateSessionLearningDraft {
  const draftId = card.durableDraftId || card.id;
  const expectedRevision = card.durableRevision ?? 1;

  const candidatePayload = {
    kind: "card",
    candidate: {
      cardType: card.type,
      question: card.question,
      answer: card.answer,
      text: card.text,
      multipleChoiceOptions: card.multipleChoiceOptions,
      multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
      concept: card.tags[0],
      evidenceQuote: card.sessionEvidence?.quote,
    },
  };

  return {
    id: draftId,
    expectedRevision,
    payloadJson: JSON.stringify(candidatePayload),
  };
}

/**
 * Maps a persisted SQLite session learning draft into an editable SessionExtractDraft.
 */
export function persistedDraftToExtractDraft(
  draft: PersistedSessionLearningDraft
): SessionExtractDraft {
  const payload = safeJsonParse<{
    kind?: string;
    verbatimText?: string;
    summaryNote?: string;
  }>(draft.payloadJson, {});

  const evidence = safeJsonParse<SessionSourceEvidence | undefined>(
    draft.evidenceJson,
    undefined
  );

  return {
    id: draft.id,
    sessionId: draft.sessionId,
    revision: draft.revision,
    verbatimText: payload.verbatimText || evidence?.quote || "",
    summaryNote: payload.summaryNote,
    conceptKey: draft.conceptKey,
    evidence,
    status: draft.status,
    selected: draft.status === "proposed",
    duplicateJson: draft.duplicateJson,
    acceptedTargetId: draft.acceptedTargetId,
    createdAt: new Date(draft.createdAt).getTime() || Date.now(),
  };
}

/**
 * Maps an edited SessionExtractDraft back into an UpdateSessionLearningDraft payload.
 */
export function extractDraftToPersistedUpdate(
  extract: SessionExtractDraft
): UpdateSessionLearningDraft {
  const payload = {
    kind: "extract",
    verbatimText: extract.verbatimText,
    summaryNote: extract.summaryNote,
  };

  return {
    id: extract.id,
    expectedRevision: extract.revision,
    payloadJson: JSON.stringify(payload),
  };
}

/**
 * Builds the atomic AcceptSessionDraftsInput payload for batch acceptance.
 */
export function buildAcceptanceInput(
  sessionId: string,
  selectedDrafts: Array<{
    id: string;
    revision: number;
    duplicateDecision?: "create" | "update" | "replace" | null;
    duplicateTargetId?: string | null;
  }>
): AcceptSessionDraftsInput {
  const items: AcceptSessionDraftSpec[] = selectedDrafts.map((d) => ({
    draftId: d.id,
    expectedRevision: d.revision,
    duplicateDecision: d.duplicateDecision,
    duplicateTargetId: d.duplicateTargetId,
  }));

  return {
    sessionId,
    items,
  };
}

/**
 * Validates grounding: true if evidence quote exists and matches verbatim.
 */
export function isDraftGrounded(evidence?: SessionSourceEvidence | null): boolean {
  if (!evidence) return false;
  return typeof evidence.quote === "string" && evidence.quote.trim().length > 0;
}
