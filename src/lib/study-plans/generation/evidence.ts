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
  retrieveFn?: (
    query: string,
    options?: {
      k?: number;
      filters?: RetrievalFilters;
      config?: EmbeddingConfig;
      includeSpotlight?: boolean;
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
    const plan = planEvidenceBatches({ sourceScope, depth, evidenceItems: [] });
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

  // 1. Initial goal query
  let goalHits: RetrievalResult[] = [];
  try {
    const res = await retrieveFn(goal, {
      k: kGoal,
      filters: { documentIds: allowedDocIdsList },
      config: embeddingConfig,
      includeSpotlight: false,
    });
    // Strict defense: drop any hit not in allowedDocIds
    goalHits = (res.results || []).filter((h) => allowedDocIds.has(h.documentId));
  } catch {
    goalHits = [];
  }

  // 2. Confirmed concept seeds
  const seeds = await findConceptSeeds(
    allowedDocIds,
    allowedExtractIds,
    maxConceptSeeds,
    listConfirmedConceptLinksFn,
    listConceptsFn
  );

  // 3. Per-seed retrieval with concurrency = 2
  const seedHitsPerSeed = await runConcurrent(seeds, concurrency, async (seed) => {
    try {
      const res = await retrieveFn(seed, {
        k: kPerSeed,
        filters: { documentIds: allowedDocIdsList },
        config: embeddingConfig,
        includeSpotlight: false,
      });
      return (res.results || []).filter((h) => allowedDocIds.has(h.documentId));
    } catch {
      return [];
    }
  });

  // 4. Aggregate & Deduplicate up to maxGlobalHits (96)
  const seenSignatures = new Set<string>();
  const uniqueHits: RetrievalResult[] = [];

  function addHit(hit: RetrievalResult) {
    if (uniqueHits.length >= maxGlobalHits) return;
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

  // 5. Source Ref Hydration
  let resolutions: StudySourceResolution[] = [];
  let evidenceItemsForBatching: Array<{
    documentId: string;
    extractId?: string;
    documentTitle: string;
    sourceType: string;
    revision: string;
    excerpt: string;
    excerptSha256?: string;
  }> = [];

  if (uniqueHits.length > 0) {
    const refInputs: StudySourceRefInput[] = uniqueHits.map((hit) => ({
      documentId: hit.documentId,
      extractId: hit.location?.extractId,
      excerpt: hit.text.slice(0, 1600),
      documentTitle: hit.documentTitle,
      sourceType: typeof hit.sourceType === 'string' ? hit.sourceType : 'document',
      jump: mapLocationToJump(hit.location),
      chunk: hit.location
        ? {
            chunkId: hit.chunkId,
            ordinal: hit.ordinal,
            startOffset: hit.location.startOffset,
            endOffset: hit.location.endOffset,
          }
        : undefined,
    }));

    try {
      resolutions = await resolveSourceRefsFn(refInputs);
    } catch {
      resolutions = [];
    }

    evidenceItemsForBatching = uniqueHits.map((hit, idx) => {
      const res = resolutions[idx];
      return {
        documentId: hit.documentId,
        extractId: hit.location?.extractId,
        documentTitle: res?.ref?.documentTitle || hit.documentTitle || 'Source',
        sourceType:
          res?.ref?.sourceType ||
          (typeof hit.sourceType === 'string' ? hit.sourceType : 'document'),
        revision: res?.ref?.revision || 'unknown',
        excerpt: res?.ref?.excerpt || hit.text.slice(0, 1600),
        excerptSha256: res?.ref?.excerptSha256,
      };
    });
  } else {
    // Fallback when 0 retrieval hits: synthesize coarse refs from resolvedDocuments
    const coarseInputs: StudySourceRefInput[] = (sourceScope.resolvedDocuments || []).map((doc) => ({
      documentId: doc.documentId,
      excerpt: `Source document: ${doc.title}`,
      documentTitle: doc.title,
      sourceType: doc.sourceType,
      revision: doc.revision,
    }));

    try {
      resolutions = await resolveSourceRefsFn(coarseInputs);
    } catch {
      resolutions = [];
    }

    evidenceItemsForBatching = (sourceScope.resolvedDocuments || []).map((doc, idx) => {
      const res = resolutions[idx];
      return {
        documentId: doc.documentId,
        documentTitle: res?.ref?.documentTitle || doc.title,
        sourceType: res?.ref?.sourceType || doc.sourceType,
        revision: res?.ref?.revision || doc.revision,
        excerpt: res?.ref?.excerpt || `Source document: ${doc.title}`,
        excerptSha256: res?.ref?.excerptSha256,
      };
    });
  }

  // 6. Partition into batches
  const plan = planEvidenceBatches({
    sourceScope,
    depth,
    evidenceItems: evidenceItemsForBatching,
  });

  // 7. Build handleToSourceRefIdMap
  const handleToSourceRefIdMap = new Map<string, string>();
  for (let i = 0; i < plan.allHandles.length; i++) {
    const handleItem = plan.allHandles[i];
    const resolution = resolutions[i];
    if (resolution?.ref?.id) {
      handleToSourceRefIdMap.set(handleItem.handle, resolution.ref.id);
    }
  }

  return {
    batches: plan.batches,
    allHandles: plan.allHandles,
    handleMap: plan.handleMap,
    handleToSourceRefIdMap,
    resolutions,
    uniqueHits,
    conceptSeeds: seeds,
  };
}
