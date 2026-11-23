import { getStudyReadingChunks, type StudyReadingChunk } from '../../../api/study-reading';
import { StudyApiError } from '../../../api/study-plans';
import { resolveStudySourceRefs } from '../../../api/study-sources';
import type { StudyPlanDetail, StudyPlanVersionNode } from '../../../types/learningPaths';
import type { StudyReadingAssignment, StudyReadingManifest, StudyReadingSegment } from '../../../types/studyReading';
import type { StudySourceRefInput, StudySourceRefV1 } from '../../../types/studySource';
import { computeCanonicalHash } from '../sourceValidation';

const MAX_QUOTE_LENGTH = 1600;
const CONTEXT_LENGTH = 240;

interface Evidence {
  ref: StudySourceRefV1;
  format: StudyReadingAssignment['format'];
  wholeDocument: boolean;
}

interface Candidate {
  topic: StudyPlanVersionNode;
  evidence: Evidence;
  segment: StudyReadingSegment;
  seed: StudyReadingSegment;
}

function quoteText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : Number(first > second);
}

function supportedFormat(format: string): StudyReadingAssignment['format'] | undefined {
  switch (format) {
    case 'epub':
    case 'pdf':
    case 'html':
    case 'markdown':
      return format;
  }
}

function eligibleEvidence(detail: StudyPlanDetail, topic: StudyPlanVersionNode): Evidence[] {
  const { sourceScope, knowledgeAuthority, state } = detail.version;
  if (state !== 'published' || knowledgeAuthority.kind === 'model-only') return [];

  return [...new Set(topic.sourceRefIds)].flatMap((id) => {
    const resolution = detail.sourceRefs[id];
    if (!resolution || resolution.status !== 'current') return [];
    const { ref } = resolution;
    if (ref.id !== id || ref.revisionKind === 'unknown') return [];
    if (!sourceScope && knowledgeAuthority.kind === 'manual') {
      const format = supportedFormat(ref.sourceType);
      return format ? [{ ref, format, wholeDocument: false }] : [];
    }
    if (!sourceScope) return [];
    const document = sourceScope.resolvedDocuments.find(({ documentId }) => documentId === ref.documentId);
    const format = supportedFormat(document?.sourceType ?? '');
    if (!format || !document || document.isAiExcluded || ref.id !== id ||
        ref.sourceType !== format || ref.revision !== document.revision) return [];
    const wholeDocument = sourceScope.selected.documentIds.includes(ref.documentId);
    if (!wholeDocument && !(ref.extractId && sourceScope.selected.extractIds.includes(ref.extractId) &&
        document.extractIds.includes(ref.extractId))) return [];
    return [{ ref, format, wholeDocument }];
  });
}

function makeSegment(quote: string, evidence: Evidence, chunk?: StudyReadingChunk): StudyReadingSegment {
  const { ref, format } = evidence;
  const hint = ref.jump?.kind === format ? ref.jump : undefined;
  const segment: StudyReadingSegment = { quote: { exact: quote } };
  if (hint?.kind === 'epub' && hint.cfi) {
    segment.location = { kind: 'epub', cfi: hint.cfi, ...(hint.cfiRange && { cfiRange: hint.cfiRange }) };
  } else if (hint && hint.kind !== 'epub') {
    const { textQuote: _textQuote, ...location } = hint;
    segment.location = location;
  }
  if (format === 'pdf' && !segment.location && chunk?.position.pageNumber) {
    segment.location = { kind: 'pdf', pageNumber: chunk.position.pageNumber };
  }
  if (format === 'epub' && chunk?.position.spineIndex != null) segment.spineIndex = chunk.position.spineIndex;
  const heading = chunk?.position.headingPath?.at(-1)?.trim();
  if (heading && heading.length <= 240) segment.heading = heading;
  if (chunk) {
    const text = quoteText(chunk.text);
    const index = text.indexOf(quote);
    if (index >= 0 && text.indexOf(quote, index + 1) === -1) {
      const prefix = text.slice(Math.max(0, index - 64), index).trim();
      const suffix = text.slice(index + quote.length, index + quote.length + 64).trim();
      if (prefix) segment.quote.prefix = prefix;
      if (suffix) segment.quote.suffix = suffix;
    }
  }
  return segment;
}

function expandQuote(seed: string, chunk: StudyReadingChunk): string {
  const text = quoteText(chunk.text);
  const index = text.indexOf(seed);
  if (index < 0 || text.indexOf(seed, index + 1) >= 0 || text.length <= seed.length) return seed;

  const allowance = Math.min(CONTEXT_LENGTH, Math.floor((MAX_QUOTE_LENGTH - seed.length) / 2));
  const before = text.slice(Math.max(0, index - allowance), index);
  const after = text.slice(index + seed.length, index + seed.length + allowance);
  const beforeSpace = before.indexOf(' ');
  const afterSpace = after.lastIndexOf(' ');
  const prefix = before.length === index || /\s/u.test(text[index - before.length - 1])
    ? before : beforeSpace < 0 ? '' : before.slice(beforeSpace + 1);
  const suffix = index + seed.length + after.length === text.length ||
      /\s/u.test(text[index + seed.length + after.length])
    ? after : afterSpace < 0 ? '' : after.slice(0, afterSpace);
  return `${prefix}${seed}${suffix}`.trim();
}

function citedChunk(evidence: Evidence, chunks: StudyReadingChunk[]): StudyReadingChunk | undefined {
  const { ref } = evidence;
  if (!evidence.wholeDocument || ref.extractId || !ref.chunk) return;
  return chunks.find((chunk) =>
    chunk.chunkId === ref.chunk?.chunkId && chunk.position.documentId === ref.documentId &&
    chunk.position.ordinal === ref.chunk.ordinal &&
    chunk.position.startOffset === ref.chunk.startOffset && chunk.position.endOffset === ref.chunk.endOffset
  );
}

function refInput(evidence: Evidence, segment: StudyReadingSegment): StudySourceRefInput {
  const { ref } = evidence;
  return {
    documentId: ref.documentId,
    revision: ref.revision,
    revisionKind: ref.revisionKind,
    extractId: ref.extractId,
    excerpt: segment.quote.exact,
    jump: segment.location,
    chunk: ref.chunk,
  };
}

function isVerified(resolution: Awaited<ReturnType<typeof resolveStudySourceRefs>>[number] | undefined,
  evidence: Evidence, segment: StudyReadingSegment): boolean {
  return resolution?.status === 'current' && resolution.ref.documentId === evidence.ref.documentId &&
    resolution.ref.revision === evidence.ref.revision &&
    (resolution.ref.extractId ?? undefined) === (evidence.ref.extractId ?? undefined) &&
    quoteText(resolution.ref.excerpt) === segment.quote.exact;
}

function objectiveIndexes(topic: StudyPlanVersionNode, quote: string): number[] {
  const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const passageWords = new Set(words(quote));
  const instructionWords = new Set(['analyze', 'apply', 'compare', 'contrast', 'define', 'describe',
    'discuss', 'evaluate', 'explain', 'identify', 'learn', 'recognize', 'understand']);
  return topic.learningObjectives.flatMap((objective, index) => {
    const keywords = [...new Set(words(objective).filter((word) => word.length >= 5 && !instructionWords.has(word)))];
    return keywords.length >= 2 && keywords.every((keyword) => passageWords.has(keyword)) ? [index] : [];
  });
}

function makeAssignment(versionId: string, candidate: Candidate): StudyReadingAssignment {
  const { topic, evidence, segment } = candidate;
  const { ref, format } = evidence;
  return {
    schemaVersion: 1,
    id: computeCanonicalHash([versionId, topic.nodeId, ref.documentId, ref.revision,
      ref.extractId ?? null, segment]),
    topicId: topic.nodeId,
    documentId: ref.documentId,
    documentTitle: ref.documentTitle,
    documentRevision: ref.revision,
    format,
    segments: [segment],
    objectiveIndexes: objectiveIndexes(topic, segment.quote.exact),
    sourceRefIds: [ref.id],
    ...(ref.sectionLabel || segment.heading ? { label: (ref.sectionLabel || segment.heading)!.slice(0, 240) } : {}),
  };
}

function mergeCandidates(candidates: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const candidate of candidates) {
    const { ref } = candidate.evidence;
    const group = groups.find(([other]) => {
      const otherRef = other.evidence.ref;
      if (ref.chunk && otherRef.chunk && ref.chunk.chunkId !== otherRef.chunk.chunkId) return false;
      return candidate.topic.nodeId === other.topic.nodeId && ref.documentId === otherRef.documentId &&
        (ref.extractId ?? null) === (otherRef.extractId ?? null) && ref.revision === otherRef.revision &&
        computeCanonicalHash(candidate.segment.location ?? null) ===
          computeCanonicalHash(other.segment.location ?? null) &&
        other.segment.quote.exact.includes(candidate.segment.quote.exact);
    });
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  return groups;
}

/** Builds local passages from the version's currently verified topic evidence. */
export async function generateReadingManifest(
  detail: StudyPlanDetail,
  signal?: AbortSignal,
): Promise<StudyReadingManifest> {
  signal?.throwIfAborted();
  const candidates = detail.version.nodes.filter((topic) => topic.included).flatMap((topic) =>
    eligibleEvidence(detail, topic).flatMap((evidence): Candidate[] => {
      const quote = quoteText(evidence.ref.excerpt);
      if (!quote || quote.length > MAX_QUOTE_LENGTH) return [];
      const seed = makeSegment(quote, evidence);
      return [{ topic, evidence, seed, segment: seed }];
    }),
  );

  const needsChunks = candidates.some(({ evidence }) => evidence.wholeDocument && !evidence.ref.extractId && evidence.ref.chunk);
  const chunks = needsChunks
    ? await getStudyReadingChunks(detail.plan.id, detail.version.id)
    : [];
  signal?.throwIfAborted();

  for (const candidate of candidates) {
    const chunk = citedChunk(candidate.evidence, chunks);
    if (!chunk) continue;
    const exact = candidate.seed.quote.exact;
    candidate.seed = makeSegment(exact, candidate.evidence, chunk);
    candidate.segment = makeSegment(expandQuote(exact, chunk), candidate.evidence, chunk);
  }
  const expanded = candidates.filter(({ segment, seed }) => segment.quote.exact !== seed.quote.exact);
  const resolutions = expanded.length
    ? await resolveStudySourceRefs(expanded.map(({ evidence, segment }) => refInput(evidence, segment))).catch(() => [])
    : [];
  signal?.throwIfAborted();
  for (const [index, candidate] of expanded.entries()) {
    if (!isVerified(resolutions[index], candidate.evidence, candidate.segment)) candidate.segment = candidate.seed;
  }

  candidates.sort((first, second) =>
    first.topic.position - second.topic.position ||
    compareText(first.topic.nodeId, second.topic.nodeId) ||
    compareText(first.evidence.ref.documentId, second.evidence.ref.documentId) ||
    ((first.segment.location?.kind === 'pdf' ? first.segment.location.pageNumber : 0) -
      (second.segment.location?.kind === 'pdf' ? second.segment.location.pageNumber : 0)) ||
    (first.evidence.ref.chunk?.ordinal ?? 0) - (second.evidence.ref.chunk?.ordinal ?? 0) ||
    second.segment.quote.exact.length - first.segment.quote.exact.length ||
    compareText(first.evidence.ref.id, second.evidence.ref.id),
  );
  return {
    assignments: mergeCandidates(candidates).map(([primary, ...duplicates]) => ({
      ...makeAssignment(detail.version.id, primary),
      sourceRefIds: [primary, ...duplicates].map(({ evidence }) => evidence.ref.id).sort(),
    })),
  };
}

export async function addManualReadingAssignment(
  detail: StudyPlanDetail,
  manifest: StudyReadingManifest,
  topicId: string,
  sourceRefId: string,
  passage: string,
  signal?: AbortSignal,
): Promise<StudyReadingManifest> {
  signal?.throwIfAborted();
  const topic = detail.version.nodes.find((node) => node.nodeId === topicId && node.included);
  const evidence = topic && eligibleEvidence(detail, topic).find(({ ref }) => ref.id === sourceRefId);
  const exact = quoteText(passage);
  const passageError = (code: 'invalid_input' | 'stale_source') => new StudyApiError({
    code,
    messageKey: code === 'invalid_input' ? 'study_reading.error.invalid_passage' : 'study_reading.error.unverified_passage',
    retryable: false,
  });
  if (!topic || !evidence || !exact || exact.length > MAX_QUOTE_LENGTH) {
    throw passageError('invalid_input');
  }

  const seedQuote = quoteText(evidence.ref.excerpt);
  if ((!evidence.wholeDocument || evidence.ref.extractId) && !seedQuote.includes(exact)) {
    throw passageError('stale_source');
  }

  const chunks = evidence.wholeDocument && evidence.ref.chunk && !evidence.ref.extractId
    ? await getStudyReadingChunks(detail.plan.id, detail.version.id) : [];
  signal?.throwIfAborted();
  const segment = makeSegment(exact, evidence, citedChunk(evidence, chunks));
  const input = refInput(evidence, segment);
  const resolved = await resolveStudySourceRefs(input.chunk ? [input, { ...input, chunk: undefined }] : [input]);
  signal?.throwIfAborted();
  if (!resolved.some((resolution) => isVerified(resolution, evidence, segment))) throw passageError('stale_source');
  const assignment = makeAssignment(detail.version.id, { topic, evidence, segment, seed: segment });
  const existing = manifest.assignments.find(({ id }) => id === assignment.id);
  if (existing?.authored && existing.sourceRefIds.includes(sourceRefId)) return manifest;
  if (existing) {
    return { assignments: manifest.assignments.map((item) => item === existing
      ? { ...item, authored: true, sourceRefIds: [...new Set([...item.sourceRefIds, sourceRefId])].sort() } : item) };
  }
  const positions = new Map(detail.version.nodes.map((node) => [node.nodeId, node.position]));
  const insertAt = manifest.assignments.findIndex((item) =>
    (positions.get(item.topicId) ?? Infinity) > topic.position,
  );
  const assignments = [...manifest.assignments];
  assignments.splice(insertAt < 0 ? assignments.length : insertAt, 0, { ...assignment, authored: true });
  return { assignments };
}
