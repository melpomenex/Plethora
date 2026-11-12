/**
 * Source-scoped Retrieval and Evidence Hydration.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/01-ARCHITECTURE.md §3.2
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §2, §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T07)
 */

import {
  retrieveFromLibrary,
  type EmbeddingConfig,
  type RetrievalFilters,
  type RetrievalResponse,
  type RetrievalResult,
} from '../../../api/ai-learning';
import {
  listConfirmedConceptLinks,
  listConcepts,
  type Concept,
  type ConceptLink,
} from '../../../api/concept-links';
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type { ExactSearchHitLocation } from '../../../types/searchHit';
import type {
  StudyDepth,
  StudySourceRefInput,
  StudySourceResolution,
  StudySourceScopeV1,
} from '../../../types/studySource';
import {
  EVIDENCE_LIMITS,
  planEvidenceBatches,
  type EvidenceBatch,
  type EvidenceHandleItem,
} from './planEvidence';

export interface HydrateEvidenceOptions {
  goal: string;
  sourceScope: StudySourceScopeV1;
  depth: StudyDepth;
  kGoal?: number; // default 24
  maxConceptSeeds?: number; // default 12
  kPerSeed?: number; // default 6
  concurrency?: number; // default 2
  maxGlobalHits?: number; // default 96
  embeddingConfig?: EmbeddingConfig;
  signal?: AbortSignal;
  beforeQuery?: () => Promise<void>;
  retrieveFn?: (
    query: string,
    options?: {
      k?: number;
      filters?: RetrievalFilters;
      config?: EmbeddingConfig;
      includeSpotlight?: boolean;
      isolatedConfig?: boolean;
    }
  ) => Promise<RetrievalResponse>;
  listConfirmedConceptLinksFn?: () => Promise<ConceptLink[]>;
  listConceptsFn?: () => Promise<Concept[]>;
  resolveSourceRefsFn?: (inputs: StudySourceRefInput[]) => Promise<StudySourceResolution[]>;
}

export interface HydratedEvidenceResult {
  batches: EvidenceBatch[];
  allHandles: EvidenceHandleItem[];
  handleMap: Map<string, EvidenceHandleItem>;
  handleToSourceRefIdMap: Map<string, string>;
  resolutions: StudySourceResolution[];
  uniqueHits: RetrievalResult[];
  conceptSeeds: string[];
  retrieval?: {
    mode: 'semantic' | 'lexicalOnly' | 'mixed' | 'unavailable';
    embeddingModels: string[];
    queryCount: number;
    failedQueries: number;
    retrievedCandidates: number;
    candidatesInScope: number;
    submittedPassages: number;
    rejectedPassages: number;
    retrievalMs: number;
    verificationMs: number;
    verifiedPassages: number;
    documentsWithEvidence: number;
  };
}

/**
 * Runs an array of items through an async mapper with a maximum concurrency limit.
 */
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

function mapLocationToJump(loc?: import('../../../api/ai-learning').ChunkLocation): ExactSearchHitLocation | undefined {
  if (!loc) return undefined;
  if (loc.sourceType === 'pdf' && loc.pageNumber !== undefined) {
    return { kind: 'pdf', pageNumber: loc.pageNumber };
  }
  if (loc.sourceType === 'epub' && loc.cfiRange) {
    return { kind: 'epub', cfi: loc.cfiRange, cfiRange: loc.cfiRange };
  }
  if (loc.sourceType === 'audio') {
    return { kind: 'audio', timeSeconds: Math.floor((loc.timestampMs || loc.startMs || 0) / 1000) };
  }
  return undefined;
}

/**
 * Extracts allowed document IDs from the frozen source scope.
 */
export function getAllowedDocumentIds(sourceScope: StudySourceScopeV1): string[] {
  const ids = new Set<string>();
  if (sourceScope.selected?.documentIds) {
    for (const id of sourceScope.selected.documentIds) {
      if (id && id.trim()) ids.add(id.trim());
    }
  }
  if (sourceScope.resolvedDocuments) {
    for (const doc of sourceScope.resolvedDocuments) {
      if (doc.documentId && doc.documentId.trim()) ids.add(doc.documentId.trim());
    }
  }
  return Array.from(ids).sort();
}

/**
 * Identifies confirmed concept seed queries within the given source scope.
 */
async function findConceptSeeds(
  allowedDocIds: Set<string>,
  allowedExtractIds: Set<string>,
  maxSeeds: number,
  listLinksFn: () => Promise<ConceptLink[]>,
  listConceptsFn: () => Promise<Concept[]>
): Promise<string[]> {
  let links: ConceptLink[] = [];
  try {
    links = await listLinksFn();
  } catch {
    return [];
  }

  const linkedConceptIds = new Set<string>();
  for (const link of links) {
    if (link.isDismissed) continue;
    const sourceMatches =
      (link.sourceKind === 'document' && allowedDocIds.has(link.sourceId)) ||
      (link.sourceKind === 'extract' && allowedExtractIds.has(link.sourceId));
    const targetMatches =
      (link.targetKind === 'document' && allowedDocIds.has(link.targetId)) ||
      (link.targetKind === 'extract' && allowedExtractIds.has(link.targetId));

    if (sourceMatches && link.targetKind === 'concept') {
      linkedConceptIds.add(link.targetId);
    } else if (targetMatches && link.sourceKind === 'concept') {
      linkedConceptIds.add(link.sourceId);
    }
  }

  if (linkedConceptIds.size === 0) return [];

  // Look up concept names
  let concepts: Concept[] = [];
  try {
    concepts = await listConceptsFn();
  } catch {
    concepts = [];
  }

  const conceptNameById = new Map<string, string>();
  for (const c of concepts) {
    conceptNameById.set(c.id, c.name);
  }

  const seedNames: string[] = [];
  for (const cid of linkedConceptIds) {
    const name = conceptNameById.get(cid) || cid;
    if (name.trim()) seedNames.push(name.trim());
  }

  seedNames.sort((a, b) => a.localeCompare(b, 'en-US'));
  return seedNames.slice(0, maxSeeds);
}

/**
 * Hydrates evidence for curriculum generation:
 * 1. Initial goal query across allowed documents (top 24).
 * 2. Confirmed concept seeds in scope (max 12).
 * 3. Per-seed retrieval with k=6 and concurrency=2.
 * 4. Bounded unique hits up to 96.
 * 5. Source ref hydration via `resolveStudySourceRefs`.
 * 6. Evidence batching (≤12 handles, ≤18k chars per batch).
 */
export async function hydrateCurriculumEvidence(
  options: HydrateEvidenceOptions
): Promise<HydratedEvidenceResult> {
  const {
    goal,
    sourceScope,
    depth,
    kGoal = 24,
    maxConceptSeeds = EVIDENCE_LIMITS.MAX_CONCEPT_SEEDS, // 12
    kPerSeed = 6,
    concurrency = 2,
    maxGlobalHits = EVIDENCE_LIMITS.MAX_GLOBAL_HITS, // 96
    embeddingConfig,
    signal,
    beforeQuery,
    retrieveFn = retrieveFromLibrary,
    listConfirmedConceptLinksFn = listConfirmedConceptLinks,
    listConceptsFn = listConcepts,
    resolveSourceRefsFn = resolveStudySourceRefs,
  } = options;

  const allowedDocIdsList = getAllowedDocumentIds(sourceScope);
  const allowedDocIds = new Set(allowedDocIdsList);
  const allowedExtractIds = new Set(sourceScope.selected?.extractIds || []);

  if (allowedDocIdsList.length === 0) {
    // Empty scope produces empty handles
    const plan = planEvidenceBatches({ depth, evidenceItems: [] });
    return {
      batches: plan.batches,
      allHandles: plan.allHandles,
      handleMap: plan.handleMap,
      handleToSourceRefIdMap: new Map(),
      resolutions: [],
      uniqueHits: [],
      conceptSeeds: [],
    };
  }

  const fullDocumentIds = new Set(sourceScope.selected.documentIds);
  const documentsById = new Map(sourceScope.resolvedDocuments.map((doc) => [doc.documentId, doc]));
  const modes = new Set<RetrievalResponse['mode']>();
  const embeddingModels = new Set<string>();
  let failedQueries = 0;
  let queryCount = 0;
  let retrievedCandidates = 0;
  let candidatesInScope = 0;
  const retrievalStarted = performance.now();

  async function retrieve(query: string, k: number): Promise<RetrievalResult[]> {
    await beforeQuery?.();
    signal?.throwIfAborted();
    queryCount++;
    try {
      const response = await retrieveFn(query, {
        k,
        filters: { documentIds: allowedDocIdsList },
        config: embeddingConfig,
        includeSpotlight: false,
        isolatedConfig: true,
      });
      modes.add(response.mode);
      if (response.mode === 'semantic' && response.embeddingModel) {
        embeddingModels.add(response.embeddingModel);
      }
      retrievedCandidates += response.results.length;
      const hits = response.results.filter((hit) => {
        if (!allowedDocIds.has(hit.documentId)) return false;
        const extractId = hit.location?.extractId ?? (hit.sourceType === 'extract' ? hit.sourceId : undefined);
        return fullDocumentIds.has(hit.documentId) || !!extractId && allowedExtractIds.has(extractId);
      });
      candidatesInScope += hits.length;
      return hits;
    } catch {
      signal?.throwIfAborted();
      failedQueries++;
      return [];
    }
  }

  const goalHits = await retrieve(goal, kGoal);
  const seeds = await findConceptSeeds(
    fullDocumentIds,
    allowedExtractIds,
    Math.min(maxConceptSeeds, EVIDENCE_LIMITS.MAX_CONCEPT_SEEDS),
    listConfirmedConceptLinksFn,
    listConceptsFn,
  );
  const seedHitsPerSeed = await runConcurrent(seeds, concurrency, (seed) => retrieve(seed, kPerSeed));

  const retrievalMs = performance.now() - retrievalStarted;

  // 4. Aggregate & Deduplicate up to maxGlobalHits (96)
  const seenSignatures = new Set<string>();
  const uniqueHits: RetrievalResult[] = [];

  function addHit(hit: RetrievalResult) {
    if (uniqueHits.length >= Math.min(maxGlobalHits, EVIDENCE_LIMITS.MAX_GLOBAL_HITS)) return;
    const sig = hit.chunkId
      ? `${hit.documentId}:${hit.chunkId}`
      : `${hit.documentId}:${hit.location?.startOffset ?? 0}-${hit.location?.endOffset ?? 0}:${hit.text.trim()}`;
    if (seenSignatures.has(sig)) return;
    seenSignatures.add(sig);
    uniqueHits.push(hit);
  }

  for (const hit of goalHits) {
    addHit(hit);
  }
  for (const hits of seedHitsPerSeed) {
    for (const hit of hits) {
      addHit(hit);
    }
  }

  signal?.throwIfAborted();
  const refInputs: StudySourceRefInput[] = uniqueHits.filter((hit) => hit.text.trim()).map((hit) => ({
    documentId: hit.documentId,
    extractId: hit.location?.extractId ?? (hit.sourceType === 'extract' ? hit.sourceId : undefined),
    excerpt: hit.text.trim().slice(0, EVIDENCE_LIMITS.MAX_EXCERPT_CHARS).replace(/[\uD800-\uDBFF]$/, ''),
    documentTitle: hit.documentTitle,
    sourceType: hit.sourceType,
    revision: documentsById.get(hit.documentId)?.revision,
    jump: mapLocationToJump(hit.location),
    chunk: hit.location && hit.location.sourceType !== 'fts' && hit.chunkId ? {
      chunkId: hit.chunkId,
      ordinal: hit.ordinal,
      startOffset: hit.location.startOffset,
      endOffset: hit.location.endOffset,
    } : undefined,
  }));
  const verificationStarted = performance.now();
  const resolutions = refInputs.length ? await resolveSourceRefsFn(refInputs) : [];
  const verifiedRefs = resolutions.flatMap(({ status, ref }, index) => {
    const input = refInputs[index];
    // Rust serializes a missing extract ID as null. Document inputs omit it.
    const extractId = ref.extractId ?? undefined;
    return status === 'current' && input && ref.documentId === input.documentId &&
      extractId === input.extractId && (!input.revision || ref.revision === input.revision) &&
      ref.excerpt === input.excerpt.replace(/\r\n/g, '\n') &&
      ref.revisionKind !== 'unknown'
      ? [{ ...ref, extractId }] : [];
  });
  const verificationMs = performance.now() - verificationStarted;
  const refKey = (ref: { documentId: string; extractId?: string; excerpt: string }) =>
    JSON.stringify([ref.documentId, ref.extractId, ref.excerpt.trim()]);
  const refsByEvidence = new Map(verifiedRefs.map((ref) => [refKey(ref), ref.id]));
  const plan = planEvidenceBatches({ depth, evidenceItems: verifiedRefs });
  const handleToSourceRefIdMap = new Map(plan.allHandles.flatMap((item) => {
    const id = refsByEvidence.get(refKey(item));
    return id ? [[item.handle, id] as const] : [];
  }));

  return {
    batches: plan.batches,
    allHandles: plan.allHandles,
    handleMap: plan.handleMap,
    handleToSourceRefIdMap,
    resolutions,
    uniqueHits,
    conceptSeeds: seeds,
    retrieval: {
      mode: modes.size > 1 ? 'mixed' : modes.values().next().value ?? 'unavailable',
      embeddingModels: [...embeddingModels],
      queryCount,
      failedQueries,
      retrievedCandidates,
      candidatesInScope,
      submittedPassages: refInputs.length,
      rejectedPassages: refInputs.length - verifiedRefs.length,
      retrievalMs,
      verificationMs,
      verifiedPassages: plan.allHandles.length,
      documentsWithEvidence: new Set(plan.allHandles.map((item) => item.documentId)).size,
    },
  };
}
