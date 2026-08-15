/**
 * Candidate validation pipeline for the "Learn this" proposal (task 2.2,
 * design D16 / ai-learning-material-generation "Candidate validation").
 *
 * Runs AFTER the task-level schema validation and before anything is
 * previewed, producing a `ValidatedProposal` with a per-candidate status:
 *
 *   - `valid`      — grounded in the source, no duplicates found;
 *   - `ungrounded` — answer not grounded in the passage, or a cloze deletion
 *                    that does not appear verbatim in the source (flagged;
 *                    cannot be accepted without editing);
 *   - `duplicate`  — near-identical to an earlier candidate in the same
 *                    proposal, or to an existing learning item
 *                    (`check_semantic_duplicate_candidates`, ≥ 0.85 — the same
 *                    threshold `create_learning_item` enforces).
 *
 * Nothing here creates or mutates domain state; acceptance happens exclusively
 * through the existing domain APIs from the preview UI.
 */

import {
  checkAnswerGrounding,
  deduplicateOnDeviceCards,
  extractClozeDeletion,
  normalizeText,
  type InternalOnDeviceFlashcard,
} from "../../cardValidator";
import {
  checkSemanticDuplicateCandidates,
  type DuplicateCandidate,
} from "../../../../api/learning-items";
import type { LearningCardCandidate, LearningMaterialProposal } from "../../schemas/learningMaterial";
import type { AIProvider } from "../../providers/types";
import { runTask } from "../runTask";
import type { AITaskResult } from "../types";
import type { LearnThisInput } from "./learnThisTask";
import { learnThisTask } from "./learnThisTask";

export type LearnCandidateStatus = "valid" | "ungrounded" | "duplicate";

/** Similarity at which `create_learning_item` refuses a card — mirror it. */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

export interface ValidatedLearnCandidate {
  candidate: LearningCardCandidate;
  status: LearnCandidateStatus;
  /** Why the candidate was flagged (empty for `valid`). */
  issues: string[];
  /** Existing-item id this candidate duplicates (status `duplicate` only). */
  duplicateOfItemId?: string;
  /** 1-based index of the earlier proposal candidate this one duplicates. */
  duplicateOfIndex?: number;
  /** Answer-grounding score from `checkAnswerGrounding` (0–1). */
  groundingScore: number;
}

export interface ValidatedProposal {
  proposal: LearningMaterialProposal;
  candidates: ValidatedLearnCandidate[];
  /** Number of candidates that passed every check. */
  validCount: number;
}

export interface LearnThisValidationDeps {
  /**
   * Existing-item duplicate check. Defaults to the real
   * `check_semantic_duplicate_candidates` wrapper; tests inject a fake.
   * Errors are treated as "no duplicates known" — flagging is advisory.
   */
  checkExistingDuplicates?: (
    question: string,
    limit?: number
  ) => Promise<DuplicateCandidate[]>;
}

/** Verbatim containment on normalized whitespace (mirrors the schema check). */
function containsVerbatim(source: string, needle: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return squash(source).includes(squash(needle));
}

/** Signature used by `deduplicateOnDeviceCards` (question+answer per type). */
function candidateSignature(candidate: LearningCardCandidate): string {
  return `${candidate.cardType === "cloze" ? "cloze" : "qa"}:${normalizeText(
    candidate.question
  )}:${normalizeText(candidate.answer)}`;
}

/**
 * Source-grounding check for a single candidate: the cloze deletion must
 * appear verbatim in the source passage, and the answer must be
 * grounding-checked against it. Exported for the preview UI's edit-time
 * re-validation (a flagged candidate becomes acceptable once edited).
 */
export function checkCandidateGrounding(
  candidate: Pick<LearningCardCandidate, "cardType" | "answer" | "clozeText" | "question">,
  sourcePassage: string
): { grounded: boolean; groundingScore: number; issues: string[] } {
  const issues: string[] = [];

  if (candidate.cardType === "cloze") {
    const deletion = extractClozeDeletion(candidate.clozeText ?? candidate.question);
    if (!deletion) {
      issues.push("cloze deletion missing");
    } else if (sourcePassage && !containsVerbatim(sourcePassage, deletion)) {
      issues.push("cloze deletion not found verbatim in the source passage");
    }
  }

  const grounding = checkAnswerGrounding(candidate.answer, sourcePassage);
  if (!grounding.grounded) {
    issues.push("answer not grounded in the source passage");
  }

  return { grounded: issues.length === 0, groundingScore: grounding.score, issues };
}

/**
 * Validate a proposal's candidates against the source passage, each other, and
 * the existing library.
 */
export async function validateLearnThisProposal(
  proposal: LearningMaterialProposal,
  sourcePassage: string,
  deps: LearnThisValidationDeps = {}
): Promise<ValidatedProposal> {
  const checkExistingDuplicates =
    deps.checkExistingDuplicates ??
    (async (question: string, limit?: number) =>
      checkSemanticDuplicateCandidates(question, limit).catch(() => [] as DuplicateCandidate[]));

  // 1. Self-dedup signature pass: candidates that duplicate an EARLIER
  //    candidate in the same proposal are flagged (kept for user inspection,
  //    not silently dropped — the spec says duplicates must be flagged).
  const seenSignatures = new Map<string, number>();
  const selfDuplicateOf = new Map<number, number>();
  proposal.suggestedCards.forEach((candidate, index) => {
    const signature = candidateSignature(candidate);
    const firstIndex = seenSignatures.get(signature);
    if (firstIndex !== undefined) {
      selfDuplicateOf.set(index, firstIndex);
    } else {
      seenSignatures.set(signature, index);
    }
  });

  // 2. Existing-item duplicate check (one query per candidate; caps keep this
  //    at ≤ 8 lookups).
  const existingDuplicates = new Map<number, DuplicateCandidate>();
  await Promise.all(
    proposal.suggestedCards.map(async (candidate, index) => {
      if (selfDuplicateOf.has(index)) return;
      try {
        const found = await checkExistingDuplicates(candidate.question, 3);
        const match = found.find((d) => d.similarity >= DUPLICATE_SIMILARITY_THRESHOLD);
        if (match) existingDuplicates.set(index, match);
      } catch {
        // Duplicate flagging is advisory; never block the preview on it.
      }
    })
  );

  // 3. Per-candidate status.
  const candidates: ValidatedLearnCandidate[] = proposal.suggestedCards.map(
    (candidate, index) => {
      const grounding = checkCandidateGrounding(candidate, sourcePassage);
      const issues: string[] = [...grounding.issues];

      if (grounding.grounded) {
        const selfIndex = selfDuplicateOf.get(index);
        if (selfIndex !== undefined) {
          return {
            candidate,
            status: "duplicate" as const,
            issues: [`duplicate of suggested card ${selfIndex + 1}`, ...issues],
            duplicateOfIndex: selfIndex + 1,
            groundingScore: grounding.groundingScore,
          };
        }
        const existing = existingDuplicates.get(index);
        if (existing) {
          return {
            candidate,
            status: "duplicate" as const,
            issues: [`similar to existing card ${existing.id}`, ...issues],
            duplicateOfItemId: existing.id,
            groundingScore: grounding.groundingScore,
          };
        }
      }

      return {
        candidate,
        status: grounding.grounded ? ("valid" as const) : ("ungrounded" as const),
        issues,
        groundingScore: grounding.groundingScore,
      };
    }
  );

  return {
    proposal,
    candidates,
    validCount: candidates.filter((c) => c.status === "valid").length,
  };
}

/**
 * Convert learning-card candidates to the internal on-device flashcard shape
 * and self-deduplicate with the existing `deduplicateOnDeviceCards` helper
 * (first occurrence wins). Exported for tests.
 */
export function dedupeCandidates(
  candidates: LearningCardCandidate[]
): LearningCardCandidate[] {
  const internal: InternalOnDeviceFlashcard[] = candidates.map((candidate) => ({
    question: candidate.question,
    answer: candidate.answer,
    card_type: candidate.cardType === "cloze" ? "cloze" : "qa",
    tags: candidate.tags ?? [],
    validation: {
      valid: true,
      grounded: true,
      evidenceFound: false,
      reasons: [],
      acceptanceScore: 1,
    },
  }));
  // Which signatures survive dedup (first occurrence wins) …
  const canonical = new Set(
    deduplicateOnDeviceCards(internal).map(
      (card) => `${card.card_type}:${normalizeText(card.question)}:${normalizeText(card.answer)}`
    )
  );
  // … then keep only the FIRST original candidate per surviving signature.
  const seen = new Set<string>();
  const kept: LearningCardCandidate[] = [];
  for (const candidate of candidates) {
    const signature = candidateSignature(candidate);
    if (canonical.has(signature) && !seen.has(signature)) {
      seen.add(signature);
      kept.push(candidate);
    }
  }
  return kept;
}

// ──────────────────────────────────────────────────────────────────────────
// End-to-end run: task layer → validation pipeline
// ──────────────────────────────────────────────────────────────────────────

/** Result of one "Learn this" run: validated proposal + provenance inputs. */
export interface LearnThisRun {
  validated: ValidatedProposal;
  /** The task-layer run (provider/model/modelClass for provenance). */
  run: AITaskResult<LearningMaterialProposal>;
}

export interface LearnThisRunOptions {
  signal?: AbortSignal;
  /** Explicit provider injection (tests / FakeAIProvider eval runs). */
  provider?: AIProvider;
  /** Pins the provider kind when the caller already resolved availability. */
  kind?: "ondevice" | "cloud";
}

/**
 * Run the Learn this task through the real task layer and validate its
 * proposal through the candidate pipeline. Throws the task layer's typed
 * `AIError`s (cancellation, timeout, invalid structured output) — nothing is
 * created on failure (spec: "Proposal timeout or failure creates nothing").
 */
export async function runLearnThis(
  input: LearnThisInput,
  options: LearnThisRunOptions = {},
  deps: LearnThisValidationDeps = {}
): Promise<LearnThisRun> {
  const run = await runTask(learnThisTask, input, {
    signal: options.signal,
    provider: options.provider,
    kind: options.kind,
  });
  const validated = await validateLearnThisProposal(run.output, input.passage, deps);
  return { validated, run };
}
