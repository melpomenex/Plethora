/**
 * Source-grounded proposal validation + retry-safe acceptance for the
 * Learning Agent (tasks 3.2/3.3/3.5).
 *
 * This module is UI-free. It:
 *  - adapts validated agent proposals into the existing
 *    `LearningCardCandidate` / `learnThisValidation` contract;
 *  - groups previews by their primary source and enforces the existing
 *    8-cards / 2-per-concept caps per source group;
 *  - blocks acceptance when grounding fails, a duplicate is found, or the
 *    duplicate service is unavailable (the failure is never treated as
 *    uniqueness);
 *  - saves ONLY selected rows through existing domain writers, one source
 *    group at a time, so a late failure cannot hide earlier committed ids;
 *  - uses narrow (acceptanceId, proposalId) idempotency keys and reconciles an
 *    ambiguous transport failure by querying the acceptance key;
 *  - records provenance separately and reports "saved; metadata needs repair"
 *    without ever recreating the card.
 */

import {
  checkSemanticDuplicateCandidates,
  createLearningItem,
  createLearningItemsBatch,
  getLearningItemsByAcceptanceKey,
  searchLearningItemsBounded,
  type CreateLearningItemInput,
  type DuplicateCandidate,
  type LearningItem,
} from "../../../api/learning-items";
import { createClozeFromExtract } from "../../../api/extract-review";
import { recordAiProvenance } from "../../../api/ai-provenance";
import { fnv1aHash } from "../providers/types";
import {
  LEARNING_CARD_TYPES,
  type LearningCardCandidate,
  type LearningCardType,
} from "../schemas/learningMaterial";
import {
  checkCandidateGrounding,
  DUPLICATE_SIMILARITY_THRESHOLD,
} from "../tasks/definitions/learnThisValidation";
import { clozeToCleanTextAndRanges } from "../../../components/learn/acceptLearnThis";
import type {
  AgentCardProposal,
  AgentProposal,
  AgentProposalSourceRef,
} from "../agent/tools/types";
import type {
  AgentDraftArtifact,
  AgentDraftCandidate,
  AgentDraftSourceRef,
} from "./conversations/types";
import { AGENT_DRAFT_ARTIFACT_VERSION } from "./conversations/types";
import type { SourceReference } from "./conversations/types";
import { serializeCardSourceReference } from "../../../types/cardSourceReference";
import { useDocumentStore } from "../../../stores/documentStore";
import { recordLearningAgentStage } from "./learningAgent";

export const AGENT_PREVIEW_MAX_CARDS_PER_SOURCE = 8;
export const AGENT_PREVIEW_MAX_CARDS_PER_CONCEPT = 2;
export const AGENT_DUPLICATE_CHECK_UNAVAILABLE =
  "Duplicate check unavailable. Retry the check before accepting this candidate.";

/* ------------------------------------------------------------------------- */
/* Candidate adaptation                                                      */
/* ------------------------------------------------------------------------- */

function isCardType(value: string): value is LearningCardType {
  return (LEARNING_CARD_TYPES as readonly string[]).includes(value);
}

/** Deterministic concept key when the model did not name a concept. */
export function deriveConceptKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 4)
    .join(" ") || question.trim().toLowerCase();
}

/**
 * Adapt one agent card proposal to the existing candidate contract. Card
 * types outside the learning-material enum fall back to `qa` (the same
 * semantic the proposal tool promised).
 */
export function proposalToLearningCandidate(
  proposal: AgentCardProposal
): LearningCardCandidate {
  const cardType: LearningCardType =
    proposal.cardType === "cloze"
      ? "cloze"
      : isCardType(proposal.cardType)
        ? proposal.cardType
        : "qa";
  const concept = proposal.concept?.trim() || deriveConceptKey(proposal.question);
  return {
    cardType,
    concept,
    conceptKeys: proposal.conceptKeys?.length
      ? [...proposal.conceptKeys]
      : [concept],
    question: proposal.question,
    answer: proposal.answer,
    clozeText: cardType === "cloze" ? proposal.question : undefined,
    evidenceQuote: proposal.evidenceQuote ?? proposal.sourceRefs[0]?.text.slice(0, 300),
    tags: proposal.tags,
  };
}

export function primarySource(
  proposal: AgentProposal
): AgentProposalSourceRef | undefined {
  return proposal.sourceRefs[0];
}

export function sourceGroupKey(proposal: AgentProposal): string {
  const source = primarySource(proposal);
  if (!source) return "unresolved";
  return `${source.kind === "extract" ? "extract" : "document"}:${
    source.documentId ?? source.refId
  }`;
}

export function sourceGroupTitle(proposal: AgentProposal): string {
  const source = primarySource(proposal);
  return source?.title ?? "Library source";
}

/* ------------------------------------------------------------------------- */
/* Grouping + caps                                                           */
/* ------------------------------------------------------------------------- */

export type AgentReviewStatus =
  | "draft"
  | "validating"
  | "valid"
  | "ungrounded"
  | "duplicate"
  | "duplicate-unavailable"
  | "cap-exceeded"
  | "saving"
  | "saved"
  | "failed"
  | "rejected";

export interface AgentCardReview {
  proposalId: string;
  proposal: AgentCardProposal;
  candidate: LearningCardCandidate;
  sourceText: string;
  status: AgentReviewStatus;
  issues: string[];
  groundingOk: boolean;
  duplicateChecked: boolean;
  duplicateOk: boolean;
  duplicateOfItemId?: string;
  duplicateOfProposalId?: string;
  edited: boolean;
  accepted: boolean;
  saving: boolean;
  savedId?: string;
  provenancePending?: boolean;
}

export interface AgentSimpleProposalReview {
  proposalId: string;
  proposal: AgentProposal;
  status: AgentReviewStatus;
  issues: string[];
  accepted: boolean;
  savedId?: string;
  provenancePending?: boolean;
}

export interface AgentProposalGroup {
  key: string;
  title: string;
  documentId?: string;
  extractionSourceId?: string;
  cards: AgentCardReview[];
  extracts: AgentSimpleProposalReview[];
  tags: AgentSimpleProposalReview[];
  occlusions: AgentSimpleProposalReview[];
  /** True when a cap removed/blocked at least one card in this group. */
  capApplied: boolean;
}

export interface BuildAgentGroupsOptions {
  /** Proposal ids previously accepted/saved (restored artifacts). */
  acceptedProposalIds?: ReadonlySet<string>;
  savedIds?: ReadonlyMap<string, string>;
}

/**
 * Group proposals by their primary source and apply the existing preview caps
 * per source group (8 cards total, 2 per concept). Cap-exceeded rows are kept
 * visible with a typed issue rather than silently disappearing.
 */
export function buildAgentProposalGroups(
  proposals: AgentProposal[],
  options: BuildAgentGroupsOptions = {}
): AgentProposalGroup[] {
  const groups = new Map<string, AgentProposalGroup>();
  const ensureGroup = (proposal: AgentProposal): AgentProposalGroup => {
    const key = sourceGroupKey(proposal);
    let group = groups.get(key);
    if (!group) {
      const source = primarySource(proposal);
      group = {
        key,
        title: sourceGroupTitle(proposal),
        documentId: source?.documentId,
        extractionSourceId: source?.kind === "extract" ? source.refId : undefined,
        cards: [],
        extracts: [],
        tags: [],
        occlusions: [],
        capApplied: false,
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const proposal of proposals) {
    const group = ensureGroup(proposal);
    const source = primarySource(proposal);
    const sourceText = source?.text ?? "";
    const savedId = options.savedIds?.get(proposal.proposalId);
    const accepted = options.acceptedProposalIds?.has(proposal.proposalId) ?? false;

    if (proposal.kind === "flashcard" || proposal.kind === "cloze") {
      const candidate = proposalToLearningCandidate(proposal);
      const conceptCount = new Map<string, number>();
      for (const existing of group.cards) {
        if (existing.status === "cap-exceeded") continue;
        for (const key of existing.candidate.conceptKeys ?? []) {
          conceptCount.set(key, (conceptCount.get(key) ?? 0) + 1);
        }
      }
      const conceptKeys = candidate.conceptKeys ?? [];
      const overConcept = conceptKeys.some(
        (key) => (conceptCount.get(key) ?? 0) >= AGENT_PREVIEW_MAX_CARDS_PER_CONCEPT
      );
      const activeCount = group.cards.filter((card) => card.status !== "cap-exceeded").length;
      const overGroup = activeCount >= AGENT_PREVIEW_MAX_CARDS_PER_SOURCE;
      if (overGroup || overConcept) {
        group.capApplied = true;
        group.cards.push({
          proposalId: proposal.proposalId,
          proposal,
          candidate,
          sourceText,
          status: "cap-exceeded",
          issues: [
            overGroup
              ? `Preview cap: at most ${AGENT_PREVIEW_MAX_CARDS_PER_SOURCE} cards per source are shown.`
              : `Preview cap: at most ${AGENT_PREVIEW_MAX_CARDS_PER_CONCEPT} cards per concept are shown.`,
          ],
          groundingOk: false,
          duplicateChecked: false,
          duplicateOk: false,
          edited: false,
          accepted: false,
          saving: false,
        });
        continue;
      }
      for (const key of conceptKeys) {
        conceptCount.set(key, (conceptCount.get(key) ?? 0) + 1);
      }
      group.cards.push({
        proposalId: proposal.proposalId,
        proposal,
        candidate,
        sourceText,
        status: "draft",
        issues: [],
        groundingOk: false,
        duplicateChecked: false,
        duplicateOk: false,
        edited: false,
        accepted,
        saving: false,
        savedId,
      });
      continue;
    }

    const review: AgentSimpleProposalReview = {
      proposalId: proposal.proposalId,
      proposal,
      status: savedId ? "saved" : accepted ? "draft" : "draft",
      issues: [],
      accepted,
      savedId,
    };
    if (proposal.kind === "extract") group.extracts.push(review);
    else if (proposal.kind === "tag") group.tags.push(review);
    else if (proposal.kind === "occlusion") group.occlusions.push(review);
  }

  return [...groups.values()];
}

/* ------------------------------------------------------------------------- */
/* Validation                                                                */
/* ------------------------------------------------------------------------- */

export interface AgentValidationDeps {
  checkDuplicates?: (
    question: string,
    limit?: number
  ) => Promise<DuplicateCandidate[]>;
  /** Bounded existing-card read (concurrent recheck fallback). */
  searchCards?: typeof searchLearningItemsBounded;
}

const defaultCheckDuplicates = (question: string, limit = 3) =>
  checkSemanticDuplicateCandidates(question, limit);

/**
 * Validate one card/cloze row: grounding against the EXACT cited source text,
 * then the existing duplicate service. A service error becomes
 * `duplicate-unavailable` and blocks acceptance; edits do NOT clear it.
 */
export async function validateAgentCardReview(
  row: AgentCardReview,
  otherRows: AgentCardReview[] = [],
  deps: AgentValidationDeps = {}
): Promise<AgentCardReview> {
  const grounding = checkCandidateGrounding(row.candidate, row.sourceText);
  const issues: string[] = [...grounding.issues];

  if (!grounding.grounded) {
    return {
      ...row,
      status: "ungrounded",
      issues,
      groundingOk: false,
      duplicateChecked: false,
      duplicateOk: false,
      accepted: false,
    };
  }

  // Self-duplicate within the same source group (first occurrence wins).
  const signature = `${row.candidate.cardType}:${row.candidate.question
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()}:${row.candidate.answer.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const duplicateOfProposal = otherRows.find(
    (other) =>
      other.proposalId !== row.proposalId &&
      other.status !== "cap-exceeded" &&
      `${other.candidate.cardType}:${other.candidate.question
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()}:${other.candidate.answer.replace(/\s+/g, " ").trim().toLowerCase()}` ===
        signature
  );
  if (duplicateOfProposal) {
    return {
      ...row,
      status: "duplicate",
      issues: [...issues, `Duplicate of suggested card ${duplicateOfProposal.proposalId}`],
      groundingOk: true,
      duplicateChecked: true,
      duplicateOk: false,
      duplicateOfProposalId: duplicateOfProposal.proposalId,
      accepted: false,
    };
  }

  const checkDuplicates = deps.checkDuplicates ?? defaultCheckDuplicates;
  let duplicates: DuplicateCandidate[];
  try {
    duplicates = await checkDuplicates(row.candidate.question, 3);
  } catch {
    return {
      ...row,
      status: "duplicate-unavailable",
      issues: [...issues, AGENT_DUPLICATE_CHECK_UNAVAILABLE],
      groundingOk: true,
      duplicateChecked: false,
      duplicateOk: false,
      accepted: false,
    };
  }
  const match = duplicates.find(
    (candidate) => candidate.similarity >= DUPLICATE_SIMILARITY_THRESHOLD
  );
  if (match) {
    return {
      ...row,
      status: "duplicate",
      issues: [...issues, `Similar to existing card ${match.id}`],
      groundingOk: true,
      duplicateChecked: true,
      duplicateOk: false,
      duplicateOfItemId: match.id,
      accepted: false,
    };
  }
  return {
    ...row,
    status: "valid",
    issues,
    groundingOk: true,
    duplicateChecked: true,
    duplicateOk: true,
    // Valid candidates start accepted, matching the existing preview; the
    // user can still uncheck any row.
    accepted: true,
  };
}

/** Validate every card row in every group (bounded by the preview caps). */
export async function validateAgentProposalGroups(
  groups: AgentProposalGroup[],
  deps: AgentValidationDeps = {}
): Promise<AgentProposalGroup[]> {
  const next: AgentProposalGroup[] = [];
  for (const group of groups) {
    const cards: AgentCardReview[] = [];
    for (const row of group.cards) {
      if (row.status === "cap-exceeded") {
        cards.push(row);
        continue;
      }
      cards.push(await validateAgentCardReview(row, cards, deps));
    }
    next.push({ ...group, cards });
  }
  return next;
}

/* ------------------------------------------------------------------------- */
/* Persistence                                                               */
/* ------------------------------------------------------------------------- */

export interface AgentAcceptanceItem {
  proposalId: string;
  /** Edited candidate from the preview (revalidated at save). */
  candidate: LearningCardCandidate;
}

export interface AgentAcceptanceInput {
  runId: string;
  conversationId: string;
  provider: string;
  model?: string;
  modelClass: string;
  /** Capability revision the run was authorized under (D0 correlation). */
  capabilityRevision?: string;
  /** All proposals of the run (looked up by id for source context/kind). */
  proposals: AgentProposal[];
  /** Frozen source set from the run envelope (revision recheck at save). */
  sources?: SourceReference[];
  /** Only user-selected, validated rows. */
  selected: AgentAcceptanceItem[];
  signal?: AbortSignal;
  onCandidateState?: (
    proposalId: string,
    state: "validating" | "saving" | "saved" | "failed" | "rejected",
    detail?: { savedId?: string; error?: string; provenancePending?: boolean }
  ) => void;
}

export interface AgentAcceptanceFailure {
  proposalId: string;
  error: string;
  /** True when the failure is "duplicate check unavailable". */
  duplicateCheckUnavailable?: boolean;
}

export interface AgentAcceptanceResult {
  saved: Array<{ proposalId: string; itemId: string; provenancePending: boolean }>;
  failed: AgentAcceptanceFailure[];
  /** Saved ids recovered from the acceptance ledger after an ambiguous error. */
  reconciledProposalIds: string[];
  cancelled: boolean;
}

export interface AgentAcceptanceDeps {
  createBatch?: typeof createLearningItemsBatch;
  createOne?: typeof createLearningItem;
  createCloze?: typeof createClozeFromExtract;
  checkDuplicates?: (
    question: string,
    limit?: number
  ) => Promise<DuplicateCandidate[]>;
  findSaved?: typeof getLearningItemsByAcceptanceKey;
  recordProvenance?: typeof recordAiProvenance;
  /**
   * Source revision recheck at approval. Defaults to the document store's
   * content hash; a missing/changed source blocks the write.
   */
  getDocumentSnapshot?: (
    documentId: string
  ) => { contentVersion?: string; missing?: boolean } | null;
}

function sourceFileKind(): "html" {
  return "html";
}

/**
 * Populate the existing `source_reference` envelope for extract-less cards.
 * Extract-linked cards never use this (their extract selection_context stays
 * authoritative).
 */
export function buildAgentCardSourceReference(
  source: AgentProposalSourceRef | undefined,
  candidate: LearningCardCandidate
): string | undefined {
  if (!source?.documentId) return undefined;
  const excerpt = (candidate.evidenceQuote ?? source.text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (!excerpt) return undefined;
  const pageMatch = source.locator?.match(/page\s+(\d+)/i);
  const locator = pageMatch
    ? {
        kind: "pdf" as const,
        pageNumber: Number(pageMatch[1]),
        textQuote: excerpt,
      }
    : {
        kind: sourceFileKind(),
        textQuote: excerpt,
      };
  return serializeCardSourceReference({
    document_id: source.documentId,
    locator,
    excerpt,
    section_label: [source.title, source.locator].filter(Boolean).join(" · ") || undefined,
    fingerprint: source.sourceRevision,
    captured_at: new Date().toISOString(),
  });
}

function sourceRefsForProvenance(proposal: AgentProposal) {
  return proposal.sourceRefs.map((source) => ({
    refId: source.refId,
    kind: source.kind,
    documentId: source.documentId,
    title: source.title,
    locator: source.locator,
    contentVersion: source.contentVersion,
  }));
}

function proposalPassage(proposal: AgentProposal): string {
  return (
    proposal.sourceRefs
      .map((source) => source.text)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8_000) || proposal.sourceText
  );
}

function isCardProposal(
  proposal: AgentProposal
): proposal is AgentCardProposal {
  return proposal.kind === "flashcard" || proposal.kind === "cloze";
}

function groupSelectedBySource(
  selected: Array<{ proposal: AgentProposal; candidate: LearningCardCandidate }>
): Map<string, Array<{ proposal: AgentProposal; candidate: LearningCardCandidate }>> {
  const groups = new Map<
    string,
    Array<{ proposal: AgentProposal; candidate: LearningCardCandidate }>
  >();
  for (const entry of selected) {
    const source = primarySource(entry.proposal);
    const key = `${source?.kind === "extract" ? `extract:${source.refId}` : `doc:${source?.documentId ?? "none"}`}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

async function recordProvenance(
  item: LearningItem,
  proposal: AgentProposal,
  candidate: LearningCardCandidate | undefined,
  input: AgentAcceptanceInput,
  deps: AgentAcceptanceDeps
): Promise<boolean> {
  const record = deps.recordProvenance ?? recordAiProvenance;
  const source = primarySource(proposal);
  try {
    await record({
      targetKind: "learning_item",
      targetId: item.id,
      taskId: "agent-runner",
      provider: input.provider,
      model: input.model,
      modelClass: input.modelClass,
      inputFingerprint: fnv1aHash(proposalPassage(proposal)),
      metadata: {
        runId: input.runId,
        conversationId: input.conversationId,
        proposalId: proposal.proposalId,
        proposalKind: proposal.kind,
        documentId: source?.documentId ?? null,
        extractId: source?.kind === "extract" ? source.refId : null,
        cardType: candidate?.cardType ?? proposal.kind,
        passage: proposalPassage(proposal).slice(0, 4_000),
        sourceRefs: sourceRefsForProvenance(proposal),
        primarySourceHandle: source?.handle ?? null,
      },
    });
    return true;
  } catch (error) {
    console.warn("[learning-agent] provenance recording failed (non-fatal)", error);
    return false;
  }
}

/**
 * Save the user-selected subset through the existing writers.
 *
 * Group order is deterministic (source groups), and every group's returned ids
 * are recorded before the next group starts. On an ambiguous failure the
 * acceptance ledger is queried; recovered ids are reported as saved and are
 * never created twice. Cancellation stops before the next group but never
 * rolls back committed work.
 */
export async function saveAgentProposals(
  input: AgentAcceptanceInput,
  deps: AgentAcceptanceDeps = {}
): Promise<AgentAcceptanceResult> {
  const persistenceStartedAt = Date.now();
  const capabilityRevision = input.capabilityRevision ?? "unknown";
  const createBatch = deps.createBatch ?? createLearningItemsBatch;
  const createOne = deps.createOne ?? createLearningItem;
  const createCloze = deps.createCloze ?? createClozeFromExtract;
  const checkDuplicates = deps.checkDuplicates ?? checkSemanticDuplicateCandidates;
  const findSaved = deps.findSaved ?? getLearningItemsByAcceptanceKey;
  const getDocumentSnapshot =
    deps.getDocumentSnapshot ??
    ((documentId: string) => {
      const document = useDocumentStore
        .getState()
        .documents.find((candidate) => candidate.id === documentId);
      if (!document) return { missing: true };
      return { contentVersion: document.contentHash };
    });

  const result: AgentAcceptanceResult = {
    saved: [],
    failed: [],
    reconciledProposalIds: [],
    cancelled: false,
  };
  const proposalById = new Map(input.proposals.map((proposal) => [proposal.proposalId, proposal]));
  const selected: Array<{ proposal: AgentProposal; candidate: LearningCardCandidate }> = [];
  for (const item of input.selected) {
    const proposal = proposalById.get(item.proposalId);
    if (!proposal || !isCardProposal(proposal)) {
      result.failed.push({
        proposalId: item.proposalId,
        error: "This proposal is no longer available; start a new run.",
      });
      input.onCandidateState?.(item.proposalId, "failed", {
        error: "Proposal unavailable",
      });
      continue;
    }
    selected.push({ proposal, candidate: item.candidate });
  }

  const reconcile = async (proposalIds: string[]): Promise<Set<string>> => {
    const recovered = new Set<string>();
    try {
      const rows = await findSaved(input.runId);
      for (const row of rows) {
        const proposalId = row.proposal_id ?? undefined;
        if (!proposalId || !proposalIds.includes(proposalId)) continue;
        if (!row.id) continue;
        recovered.add(proposalId);
        result.saved.push({
          proposalId,
          itemId: row.id,
          provenancePending: false,
        });
        result.reconciledProposalIds.push(proposalId);
        input.onCandidateState?.(proposalId, "saved", { savedId: row.id });
      }
    } catch {
      // Reconciliation itself unavailable: keep the original failure; the UI
      // offers an explicit "check saved result" retry.
    }
    return recovered;
  };

  const groups = groupSelectedBySource(selected);
  for (const [, entries] of groups) {
    if (input.signal?.aborted) {
      result.cancelled = true;
      break;
    }
    const proposalIds = entries.map((entry) => entry.proposal.proposalId);
    for (const proposalId of proposalIds) input.onCandidateState?.(proposalId, "validating");

    // Revalidate at save: source revisions, grounding (exact cited text) and
    // duplicate recheck. A changed/removed source blocks the write.
    const failedValidation = new Set<string>();
    const frozenSourceVersions = new Map(
      (input.sources ?? [])
        .filter((source) => source.libraryId)
        .map((source) => [source.libraryId!, source.contentVersion])
    );
    for (const entry of entries) {
      const source = primarySource(entry.proposal);
      if (source?.documentId) {
        const frozenVersion = frozenSourceVersions.get(source.documentId);
        if (frozenVersion) {
          const snapshot = getDocumentSnapshot(source.documentId);
          if (!snapshot || snapshot.missing) {
            failedValidation.add(entry.proposal.proposalId);
            result.failed.push({
              proposalId: entry.proposal.proposalId,
              error:
                "The cited source is no longer available. Reattach and revalidate it before saving.",
            });
            input.onCandidateState?.(entry.proposal.proposalId, "failed", {
              error: "Source removed",
            });
            continue;
          }
          if (
            snapshot.contentVersion &&
            snapshot.contentVersion !== frozenVersion
          ) {
            failedValidation.add(entry.proposal.proposalId);
            result.failed.push({
              proposalId: entry.proposal.proposalId,
              error:
                "The cited source changed after this proposal was generated. Revalidate the source before saving.",
            });
            input.onCandidateState?.(entry.proposal.proposalId, "failed", {
              error: "Source changed",
            });
            continue;
          }
        }
      }
      const grounding = checkCandidateGrounding(entry.candidate, source?.text ?? "");
      if (!grounding.grounded) {
        failedValidation.add(entry.proposal.proposalId);
        result.failed.push({
          proposalId: entry.proposal.proposalId,
          error: grounding.issues[0] ?? "Candidate is not grounded in its cited source.",
        });
        input.onCandidateState?.(entry.proposal.proposalId, "failed", {
          error: "Candidate is not grounded",
        });
        continue;
      }
      try {
        const duplicates = await checkDuplicates(entry.candidate.question, 3);
        const match = duplicates.find(
          (candidate) => candidate.similarity >= DUPLICATE_SIMILARITY_THRESHOLD
        );
        if (match) {
          failedValidation.add(entry.proposal.proposalId);
          result.failed.push({
            proposalId: entry.proposal.proposalId,
            error: `Similar to existing card ${match.id}; edit the candidate or reject it.`,
          });
          input.onCandidateState?.(entry.proposal.proposalId, "failed", {
            error: "Duplicate check failed",
          });
        }
      } catch {
        failedValidation.add(entry.proposal.proposalId);
        result.failed.push({
          proposalId: entry.proposal.proposalId,
          error: AGENT_DUPLICATE_CHECK_UNAVAILABLE,
          duplicateCheckUnavailable: true,
        });
        input.onCandidateState?.(entry.proposal.proposalId, "failed", {
          error: AGENT_DUPLICATE_CHECK_UNAVAILABLE,
        });
      }
    }

    let ready = entries.filter((entry) => !failedValidation.has(entry.proposal.proposalId));
    if (ready.length === 0) continue;

    const source = primarySource(ready[0].proposal);
    const extractId = source?.kind === "extract" ? source.refId : undefined;
    const cardEntries = ready.filter((entry) => entry.candidate.cardType !== "cloze");
    const clozeEntries = ready.filter((entry) => entry.candidate.cardType === "cloze");

    if (cardEntries.length > 0) {
      const proposalIdsInGroup = cardEntries.map((entry) => entry.proposal.proposalId);
      for (const id of proposalIdsInGroup) input.onCandidateState?.(id, "saving");
      const batchInput: CreateLearningItemInput[] = cardEntries.map((entry) => ({
        item_type: entry.candidate.cardType === "qa" ? "qa" : "flashcard",
        question: entry.candidate.question,
        answer: entry.candidate.answer,
        document_id: source?.documentId,
        extract_id: extractId,
        tags: entry.candidate.tags?.length ? entry.candidate.tags : undefined,
        source_reference: extractId
          ? undefined
          : buildAgentCardSourceReference(source, entry.candidate),
        acceptance_id: input.runId,
        proposal_id: entry.proposal.proposalId,
      }));
      try {
        const items = await createBatch(batchInput);
        for (let index = 0; index < items.length; index++) {
          const entry = cardEntries[index];
          if (!entry) continue;
          const provenanceOk = await recordProvenance(
            items[index],
            entry.proposal,
            entry.candidate,
            input,
            deps
          );
          result.saved.push({
            proposalId: entry.proposal.proposalId,
            itemId: items[index].id,
            provenancePending: !provenanceOk,
          });
          input.onCandidateState?.(entry.proposal.proposalId, "saved", {
            savedId: items[index].id,
            provenancePending: !provenanceOk,
          });
        }
      } catch (error) {
        // Ambiguous transport result: query the acceptance ledger before
        // reporting failure so committed rows are not recreated.
        const recovered = await reconcile(proposalIdsInGroup);
        for (const entry of cardEntries) {
          if (recovered.has(entry.proposal.proposalId)) continue;
          result.failed.push({
            proposalId: entry.proposal.proposalId,
            error: (error as Error).message,
          });
          input.onCandidateState?.(entry.proposal.proposalId, "failed", {
            error: (error as Error).message,
          });
        }
      }
    }

    for (const entry of clozeEntries) {
      if (input.signal?.aborted) {
        result.cancelled = true;
        break;
      }
      input.onCandidateState?.(entry.proposal.proposalId, "saving");
      const clozeText = entry.candidate.clozeText ?? entry.candidate.question;
      const documentId = source?.documentId;
      try {
        let item: LearningItem;
        if (extractId) {
          const { cleanText, ranges } = clozeToCleanTextAndRanges(clozeText);
          item = await createCloze(extractId, cleanText, ranges, {
            acceptanceId: input.runId,
            proposalId: entry.proposal.proposalId,
          });
        } else {
          item = await createOne({
            item_type: "cloze",
            question: clozeText,
            cloze_text: clozeText,
            answer: entry.candidate.answer,
            document_id: documentId,
            tags: entry.candidate.tags?.length ? entry.candidate.tags : undefined,
            source_reference: buildAgentCardSourceReference(source, entry.candidate),
            acceptance_id: input.runId,
            proposal_id: entry.proposal.proposalId,
          });
        }
        const provenanceOk = await recordProvenance(
          item,
          entry.proposal,
          entry.candidate,
          input,
          deps
        );
        result.saved.push({
          proposalId: entry.proposal.proposalId,
          itemId: item.id,
          provenancePending: !provenanceOk,
        });
        input.onCandidateState?.(entry.proposal.proposalId, "saved", {
          savedId: item.id,
          provenancePending: !provenanceOk,
        });
      } catch (error) {
        const recovered = await reconcile([entry.proposal.proposalId]);
        if (recovered.has(entry.proposal.proposalId)) continue;
        result.failed.push({
          proposalId: entry.proposal.proposalId,
          error: (error as Error).message,
        });
        input.onCandidateState?.(entry.proposal.proposalId, "failed", {
          error: (error as Error).message,
        });
      }
    }

    if (result.cancelled) break;
  }

  // D0: persistence is its own stage. Generation success is never reported as
  // workflow success when this stage fails.
  recordLearningAgentStage({
    runId: input.runId,
    stage: "persistence",
    outcome: result.cancelled
      ? "cancelled"
      : result.failed.length > 0
        ? "failed"
        : "success",
    capabilityRevision,
    durationMs: Date.now() - persistenceStartedAt,
    errorCategory:
      result.failed.length > 0
        ? result.failed.some((failure) => failure.duplicateCheckUnavailable)
          ? "ValidationFailed"
          : "GenerationFailed"
        : undefined,
    recoveryCode:
      result.cancelled
        ? "cancelled"
        : result.failed.length > 0
          ? result.saved.length > 0
            ? "save_partial"
            : "save_failed"
          : undefined,
  });

  return result;
}

/**
 * Repair provenance for already-saved cards without touching the card rows.
 * Called by the preview's "repair source metadata" action.
 */
export async function repairAgentProvenance(
  input: AgentAcceptanceInput & {
    saved: Array<{ proposalId: string; itemId: string }>;
  },
  deps: AgentAcceptanceDeps = {}
): Promise<{ repaired: string[]; failed: string[] }> {
  const proposalById = new Map(input.proposals.map((proposal) => [proposal.proposalId, proposal]));
  const repaired: string[] = [];
  const failed: string[] = [];
  for (const entry of input.saved) {
    const proposal = proposalById.get(entry.proposalId);
    if (!proposal) {
      failed.push(entry.proposalId);
      continue;
    }
    const ok = await recordProvenance(
      { id: entry.itemId } as LearningItem,
      proposal,
      undefined,
      input,
      deps
    );
    if (ok) repaired.push(entry.proposalId);
    else failed.push(entry.proposalId);
  }
  return { repaired, failed };
}

/* ------------------------------------------------------------------------- */
/* Restored draft revalidation                                              */
/* ------------------------------------------------------------------------- */

export interface RevalidateRestoredDeps {
  getDocument?: (documentId: string) => Promise<{ content?: string; title?: string } | null>;
  getExtract?: (extractId: string) => Promise<{ content?: string } | null>;
}

/**
 * Restored conversation artifacts never resume execution. Their source text is
 * not persisted, so acceptance is blocked until this function re-reads the
 * exact cited record and re-anchors the evidence quote. A missing/edited
 * source is returned as stale (the UI keeps the draft but blocks saving).
 */
export async function revalidateRestoredProposalSources(
  proposals: AgentProposal[],
  deps: RevalidateRestoredDeps = {}
): Promise<{ proposals: AgentProposal[]; stale: string[] }> {
  const getDoc =
    deps.getDocument ??
    (async (documentId: string) => {
      const { getDocument } = await import("../../../api/documents");
      const document = await getDocument(documentId).catch(() => null);
      return document ? { content: document.content, title: document.title } : null;
    });
  const getExtract =
    deps.getExtract ??
    (async (extractId: string) => {
      const { getExtract } = await import("../../../api/extracts");
      return getExtract(extractId).catch(() => null);
    });

  const stale: string[] = [];
  const next: AgentProposal[] = [];
  for (const proposal of proposals) {
    const primary = primarySource(proposal);
    if (!primary || primary.text.trim()) {
      next.push(proposal);
      continue;
    }
    let content = "";
    if (primary.kind === "extract") {
      const extract = await getExtract(primary.refId);
      content = extract?.content ?? "";
    } else if (primary.documentId) {
      const document = await getDoc(primary.documentId);
      content = document?.content ?? "";
    }
    const quote = proposal.evidenceQuote?.replace(/\s+/g, " ").trim();
    if (!content.trim()) {
      stale.push(proposal.proposalId);
      next.push(proposal);
      continue;
    }
    let windowText = content;
    if (quote) {
      const normalized = content.replace(/\s+/g, " ");
      const index = normalized.toLowerCase().indexOf(quote.toLowerCase());
      if (index < 0) {
        stale.push(proposal.proposalId);
        next.push(proposal);
        continue;
      }
      const start = Math.max(0, index - 800);
      windowText = normalized.slice(start, index + quote.length + 800);
    } else {
      windowText = content.slice(0, 4_000);
    }
    next.push({
      ...proposal,
      sourceRefs: proposal.sourceRefs.map((ref, index) =>
        index === 0 ? { ...ref, text: windowText } : ref
      ),
    });
  }
  return { proposals: next, stale };
}

/* ------------------------------------------------------------------------- */
/* Conversation artifact                                                     */
/* ------------------------------------------------------------------------- */

export function proposalToDraftCandidate(
  proposal: AgentProposal
): AgentDraftCandidate {
  const source = primarySource(proposal);
  const sourceRefs: AgentDraftSourceRef[] = proposal.sourceRefs.map((ref) => ({
    handle: ref.handle,
    refId: ref.refId,
    kind: ref.kind,
    documentId: ref.documentId,
    title: ref.title,
    locator: ref.locator,
    contentVersion: ref.contentVersion,
  }));
  const base: AgentDraftCandidate = {
    proposalId: proposal.proposalId,
    kind: proposal.kind,
    sourceRefs,
    question:
      proposal.kind === "extract"
        ? proposal.text
        : proposal.kind === "tag"
          ? proposal.itemQuestion
          : proposal.kind === "occlusion"
            ? proposal.imageAssetId
            : proposal.question,
    answer: proposal.kind === "flashcard" || proposal.kind === "cloze" ? proposal.answer : "",
    status: "draft",
    evidenceQuote: proposal.evidenceQuote,
  };
  if (proposal.kind === "flashcard" || proposal.kind === "cloze") {
    base.cardType = proposal.cardType;
    base.concept = proposal.concept;
    base.conceptKeys = proposal.conceptKeys;
    if (proposal.kind === "cloze") base.clozeText = proposal.question;
    if (proposal.tags?.length) base.tags = proposal.tags;
  }
  if (proposal.kind === "extract") {
    base.text = proposal.text;
    base.note = proposal.note;
    base.question = source?.title ?? "Extract";
  }
  if (proposal.kind === "tag") {
    base.tag = proposal.tag;
    base.itemId = proposal.itemId;
  }
  if (proposal.kind === "occlusion") {
    base.text = proposal.imageAssetId;
  }
  return base;
}

/**
 * Build the optional artifact persisted with the conversation. It contains
 * draft content, source refs, candidate status and saved ids ONLY.
 */
export function buildAgentDraftArtifact(input: {
  runId: string;
  conversationId: string;
  intent: string;
  scope: AgentDraftArtifact["scope"];
  sources: SourceReference[];
  selection?: AgentDraftArtifact["selection"];
  sectionTitle?: string;
  proposals: AgentProposal[];
  review?: AgentProposalGroup[];
  endReason?: string;
  explanation?: string;
  partial?: boolean;
}): AgentDraftArtifact {
  const candidates = input.proposals.map(proposalToDraftCandidate);
  const byProposal = new Map(candidates.map((candidate) => [candidate.proposalId, candidate]));
  for (const group of input.review ?? []) {
    for (const card of group.cards) {
      const candidate = byProposal.get(card.proposalId);
      if (!candidate) continue;
      candidate.question = card.candidate.question;
      candidate.answer = card.candidate.answer;
      candidate.clozeText = card.candidate.clozeText;
      candidate.cardType = card.candidate.cardType;
      candidate.concept = card.candidate.concept;
      candidate.conceptKeys = card.candidate.conceptKeys;
      candidate.issues = card.issues.length ? [...card.issues] : undefined;
      candidate.savedId = card.savedId;
      candidate.provenancePending = card.provenancePending;
      candidate.status =
        card.status === "saved"
          ? "saved"
          : card.status === "failed" ||
              card.status === "duplicate-unavailable" ||
              card.status === "ungrounded" ||
              card.status === "duplicate"
            ? "failed"
            : card.status === "rejected" || card.status === "cap-exceeded"
              ? "rejected"
              : "draft";
    }
  }
  const now = Date.now();
  const sources = input.sources.slice(0, 32).map((source) => {
    // Live ephemeral capabilities are process-local; never persist a token.
    const { ephemeral: _ephemeral, ...persisted } = source;
    return persisted;
  });
  const selection = input.selection
    ? (() => {
        const { ephemeral: _ephemeral, ...persisted } = input.selection!;
        return persisted;
      })()
    : undefined;
  return {
    version: AGENT_DRAFT_ARTIFACT_VERSION,
    runId: input.runId,
    conversationId: input.conversationId,
    intent: input.intent.slice(0, 4_000),
    scope: input.scope,
    createdAt: now,
    updatedAt: now,
    sources,
    selection,
    sectionTitle: input.sectionTitle,
    candidates: candidates.slice(0, 40),
    partial: input.partial,
    endReason: input.endReason,
    explanation: input.explanation,
  };
}

/**
 * Rehydrate a persisted draft into review groups. Restored rows are always
 * `draft` (never saved/valid) and must pass source revalidation before
 * acceptance; nothing here starts a run.
 */
export function hydrateAgentDraftArtifact(
  artifact: AgentDraftArtifact
): { proposals: AgentProposal[]; savedIds: Map<string, string>; accepted: Set<string> } {
  const proposals: AgentProposal[] = [];
  const savedIds = new Map<string, string>();
  const accepted = new Set<string>();
  for (const candidate of artifact.candidates) {
    const sourceRefs: AgentProposalSourceRef[] = candidate.sourceRefs.map((ref) => ({
      ...ref,
      sourceRevision: ref.contentVersion,
      text: "",
    }));
    const base = {
      proposalId: candidate.proposalId,
      sourceRefs,
      sourceText: sourceRefs[0]?.text ?? "",
      sourceRevision: artifact.runId,
      evidenceQuote: candidate.evidenceQuote,
      createdAt: artifact.createdAt,
    };
    if (candidate.kind === "flashcard" || candidate.kind === "cloze") {
      proposals.push({
        ...base,
        kind: candidate.kind,
        question: candidate.clozeText ?? candidate.question,
        answer: candidate.answer,
        cardType: candidate.cardType ?? "qa",
        concept: candidate.concept,
        conceptKeys: candidate.conceptKeys ?? [],
        documentId: sourceRefs[0]?.documentId,
        tags: candidate.tags,
      });
    } else if (candidate.kind === "extract") {
      proposals.push({
        ...base,
        kind: "extract",
        documentId: sourceRefs[0]?.documentId ?? "",
        text: candidate.text ?? candidate.question,
        note: candidate.note,
      });
    } else if (candidate.kind === "tag") {
      proposals.push({
        ...base,
        kind: "tag",
        itemId: candidate.itemId ?? "",
        itemQuestion: candidate.itemQuestion ?? candidate.question,
        existingTags: [],
        tag: candidate.tag ?? "",
      });
    } else if (candidate.kind === "occlusion") {
      proposals.push({
        ...base,
        kind: "occlusion",
        imageAssetId: candidate.text ?? candidate.question,
        documentId: sourceRefs[0]?.documentId,
      });
    }
    if (candidate.savedId) {
      savedIds.set(candidate.proposalId, candidate.savedId);
      accepted.add(candidate.proposalId);
    }
  }
  return { proposals, savedIds, accepted };
}
