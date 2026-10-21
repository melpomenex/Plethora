/**
 * Duplicate reconciliation for session learning drafts (Task 3.6, Design D9).
 *
 * Reconciles duplicate concepts and cards in course/collection scope:
 *   - Exact content & evidence quote matching (fingerprint identity)
 *   - Lexical similarity via token Jaccard (default threshold 0.75)
 *   - Optional advisory embeddings via checkSemanticDuplicateCandidates
 *   - Bounded queries (searchLearningItemsBounded) — never fetches the whole library
 *   - Reconciliation decisions: "use_existing" | "skip" | "keep_both"
 *   - Guarantees review history and card scheduler bytes remain untouched
 */

import {
  checkSemanticDuplicateCandidates,
  searchLearningItemsBounded,
  type LearningItem,
} from "../../../api/learning-items";
import {
  acceptSessionDrafts,
  rejectSessionLearningDrafts,
} from "../../../api/recordingSessions";
import { calculateTextJaccardSimilarity } from "../../../lib/ai/cards/duplicates";
import type {
  AcceptSessionDraftResult,
  PersistedSessionLearningDraft,
} from "../../../types/recordingSession";

export const LEXICAL_DUPLICATE_THRESHOLD = 0.75;
export const SERVER_CREATE_GUARD_THRESHOLD = 0.85;

export type DuplicateMatchMethod = "exact_content" | "exact_quote" | "lexical" | "embedding";

export interface CardDuplicateMatch {
  cardId: string;
  similarity: number;
  method: DuplicateMatchMethod;
  existingQuestion: string;
  existingAnswer?: string;
  existingTags?: string[];
}

export type DuplicateResolutionDecision = "use_existing" | "skip" | "keep_both";

export interface DuplicateResolutionResult {
  draftId: string;
  decision: DuplicateResolutionDecision;
  targetCardId?: string;
  success: boolean;
  error?: string;
}

/**
 * Detect duplicates for a card draft within course/collection scope.
 * Bounded query: inspects candidate cards matching question keywords or documentIds.
 */
export async function detectDraftDuplicates(
  draft: PersistedSessionLearningDraft,
  options: {
    collectionId?: string;
    courseDocumentIds?: string[];
    lexicalThreshold?: number;
  } = {}
): Promise<CardDuplicateMatch[]> {
  if (draft.kind !== "card") {
    return [];
  }

  let cardPayload: any;
  try {
    cardPayload = JSON.parse(draft.payloadJson);
  } catch {
    return [];
  }

  const candidate = cardPayload.candidate || cardPayload;
  const question = candidate.question || "";
  const answer = candidate.answer || "";
  const evidenceQuote = candidate.evidenceQuote || "";

  if (!question.trim()) {
    return [];
  }

  const threshold = options.lexicalThreshold ?? LEXICAL_DUPLICATE_THRESHOLD;
  const matches: CardDuplicateMatch[] = [];
  const seenCardIds = new Set<string>();

  // 1. Bounded search in library/course scope
  try {
    const candidates = await searchLearningItemsBounded({
      query: question.slice(0, 80),
      documentIds: options.courseDocumentIds,
      limit: 25,
    });

    for (const card of candidates) {
      if (seenCardIds.has(card.id)) continue;

      const normQProposed = question.trim().toLowerCase();
      const normQExisting = card.question.trim().toLowerCase();
      const normAProposed = answer.trim().toLowerCase();
      const normAExisting = (card.answer || "").trim().toLowerCase();

      // a. Exact content match
      if (normQProposed === normQExisting && (!normAProposed || normAProposed === normAExisting)) {
        matches.push({
          cardId: card.id,
          similarity: 1.0,
          method: "exact_content",
          existingQuestion: card.question,
          existingAnswer: card.answer,
          existingTags: card.tags,
        });
        seenCardIds.add(card.id);
        continue;
      }

      // b. Exact quote match in question or source reference
      if (evidenceQuote && card.question.includes(evidenceQuote.trim())) {
        matches.push({
          cardId: card.id,
          similarity: 0.95,
          method: "exact_quote",
          existingQuestion: card.question,
          existingAnswer: card.answer,
          existingTags: card.tags,
        });
        seenCardIds.add(card.id);
        continue;
      }

      // c. Lexical Jaccard similarity
      const frontSim = calculateTextJaccardSimilarity(question, card.question);
      const backSim = answer && card.answer ? calculateTextJaccardSimilarity(answer, card.answer) : 0;
      const combinedSim = Math.max(frontSim, (frontSim + backSim) / 2);

      if (combinedSim >= threshold) {
        matches.push({
          cardId: card.id,
          similarity: Number(combinedSim.toFixed(3)),
          method: "lexical",
          existingQuestion: card.question,
          existingAnswer: card.answer,
          existingTags: card.tags,
        });
        seenCardIds.add(card.id);
      }
    }
  } catch (err) {
    // If bounded search is unavailable, proceed with optional semantic detector
  }

  // 2. Advisory semantic embedding candidates (optional backend call)
  try {
    const semanticCandidates = await checkSemanticDuplicateCandidates(question, 5);
    for (const sem of semanticCandidates) {
      if (seenCardIds.has(sem.id)) continue;
      if (sem.similarity >= threshold) {
        matches.push({
          cardId: sem.id,
          similarity: Number(sem.similarity.toFixed(3)),
          method: "embedding",
          existingQuestion: sem.question,
        });
        seenCardIds.add(sem.id);
      }
    }
  } catch {
    // Advisory only; failure does not block draft review
  }

  // Sort descending by similarity
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

/**
 * Apply a duplicate resolution decision to a draft:
 *   - "skip": rejects the draft without touching learning items.
 *   - "keep_both": creates a new independent card.
 *   - "use_existing": links the session source evidence to the existing card without altering review count or FSRS state.
 */
export async function resolveDraftDuplicate(
  sessionId: string,
  draftId: string,
  expectedRevision: number,
  decision: DuplicateResolutionDecision,
  targetCardId?: string
): Promise<DuplicateResolutionResult> {
  if (decision === "skip") {
    try {
      await rejectSessionLearningDrafts(sessionId, [draftId]);
      return {
        draftId,
        decision,
        success: true,
      };
    } catch (err: any) {
      return {
        draftId,
        decision,
        success: false,
        error: err?.message || "Failed to reject draft",
      };
    }
  }

  if (decision === "use_existing" && !targetCardId) {
    return {
      draftId,
      decision,
      success: false,
      error: "targetCardId required when resolving duplicate as use_existing",
    };
  }

  const duplicateDecision = decision === "use_existing" ? "update" : "create";

  try {
    const res = await acceptSessionDrafts({
      sessionId,
      items: [
        {
          draftId,
          expectedRevision,
          duplicateDecision,
          duplicateTargetId: targetCardId,
        },
      ],
    });

    const itemResult = res.results.find((r: AcceptSessionDraftResult) => r.draftId === draftId);
    if (!itemResult || !itemResult.success) {
      return {
        draftId,
        decision,
        targetCardId,
        success: false,
        error: itemResult?.error || "Acceptance failed",
      };
    }

    return {
      draftId,
      decision,
      targetCardId: itemResult.targetId ?? targetCardId,
      success: true,
    };
  } catch (err: any) {
    return {
      draftId,
      decision,
      targetCardId,
      success: false,
      error: err?.message || "Acceptance failed",
    };
  }
}
