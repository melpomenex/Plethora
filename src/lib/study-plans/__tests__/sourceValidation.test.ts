import { describe, it, expect } from 'vitest';
import {
  toCanonicalJson,
  computeCanonicalHash,
  computeExcerptSha256,
  validateSelectedSourceScope,
  validateStudySourceScope,
  validateExactSearchHitLocation,
  validateStudySourceRefInput,
  validateStudySourceRef,
  STUDY_SOURCE_LIMITS,
} from '../sourceValidation';
import type {
  SelectedSourceScope,
  StudySourceScopeV1,
  StudySourceRefInput,
  StudySourceRefV1,
} from '../../../types/studySource';

describe('Study Source Canonical Hashing and JSON Serialization', () => {
  it('serializes canonical JSON with sorted keys and NFC normalization', () => {
    const objA = { z: 1, a: 'café', m: [3, 2, 1] };
    const objB = { m: [3, 2, 1], a: 'cafe\u0301', z: 1 }; // combined accent vs NFC

    const jsonA = toCanonicalJson(objA);
    const jsonB = toCanonicalJson(objB);

    expect(jsonA).toBe('{"a":"café","m":[3,2,1],"z":1}');
    expect(jsonA).toBe(jsonB);
    expect(computeCanonicalHash(objA)).toBe(computeCanonicalHash(objB));
    expect(computeCanonicalHash(objA)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects non-finite numbers in canonical JSON', () => {
    expect(() => toCanonicalJson({ bad: NaN })).toThrow(/Non-finite number/);
    expect(() => toCanonicalJson({ bad: Infinity })).toThrow(/Non-finite number/);
  });

  it('computes excerpt SHA-256 with CRLF to LF normalization', () => {
    const excerptWindows = 'First line\r\nSecond line';
    const excerptUnix = 'First line\nSecond line';

    const hashWin = computeExcerptSha256(excerptWindows);
    const hashUnix = computeExcerptSha256(excerptUnix);

    expect(hashWin).toBe(hashUnix);
    expect(hashWin).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('Source Scope Validation', () => {
  it('enforces maximum 24 documents and 200 extracts on selected scope', () => {
    const validScope: SelectedSourceScope = {
      documentIds: Array.from({ length: 24 }, (_, i) => `doc-${i}`),
      extractIds: Array.from({ length: 200 }, (_, i) => `ext-${i}`),
      collectionIds: [],
      tagIds: [],
    };
    expect(validateSelectedSourceScope(validScope).ok).toBe(true);

    const oversizedDocs: SelectedSourceScope = {
      ...validScope,
      documentIds: Array.from({ length: 25 }, (_, i) => `doc-${i}`),
    };
    expect(validateSelectedSourceScope(oversizedDocs).ok).toBe(false);

    const oversizedExtracts: SelectedSourceScope = {
      ...validScope,
      extractIds: Array.from({ length: 201 }, (_, i) => `ext-${i}`),
    };
    expect(validateSelectedSourceScope(oversizedExtracts).ok).toBe(false);
  });

  it('validates resolved source scope and requires documents sorted by documentId', () => {
    const validScope: StudySourceScopeV1 = {
      schemaVersion: 1,
      selected: { documentIds: ['doc-1', 'doc-2'], extractIds: [], collectionIds: [], tagIds: [] },
      resolvedDocuments: [
        {
          documentId: 'doc-1',
          title: 'Document 1',
          sourceType: 'pdf',
          revision: 'rev-abc',
          revisionKind: 'content-hash',
          extractIds: [],
          isAiExcluded: false,
          isLocalOnly: true,
        },
        {
          documentId: 'doc-2',
          title: 'Document 2',
          sourceType: 'epub',
          revision: '2026-11-10T12:00:00Z',
          revisionKind: 'modified-at',
          extractIds: [],
          isAiExcluded: false,
          isLocalOnly: true,
        },
      ],
      frozenAt: '2026-11-10T17:00:00Z',
      indexCompleteness: 'complete',
      limitations: [],
    };
    expect(validateStudySourceScope(validScope).ok).toBe(true);

    // Empty resolved scope
    const emptyScope: StudySourceScopeV1 = { ...validScope, resolvedDocuments: [] };
    const emptyRes = validateStudySourceScope(emptyScope);
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.error.code).toBe('invalid_input');
    }

    // Unsorted documents
    const unsortedScope: StudySourceScopeV1 = {
      ...validScope,
      resolvedDocuments: [
        validScope.resolvedDocuments[1],
        validScope.resolvedDocuments[0],
      ],
    };
    const unsortedRes = validateStudySourceScope(unsortedScope);
    expect(unsortedRes.ok).toBe(false);
  });
});

describe('Per-Kind Jump Location Validation', () => {
  it('validates PDF jump fields (pageNumber >= 1 integer, non-negative offset hint)', () => {
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: 1 })).toHaveLength(0);
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: 42, textOffsetHint: 100 })).toHaveLength(0);

    // Invalid page numbers
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: 0 })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: -5 })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: 1.5 })).toHaveLength(1);

    // Invalid offset hint
    expect(validateExactSearchHitLocation({ kind: 'pdf', pageNumber: 1, textOffsetHint: -1 })).toHaveLength(1);
  });

  it('validates EPUB CFI and range', () => {
    expect(
      validateExactSearchHitLocation({ kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)' })
    ).toHaveLength(0);

    // Empty CFI
    expect(validateExactSearchHitLocation({ kind: 'epub', cfi: '' })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'epub', cfi: '   ' })).toHaveLength(1);
  });

  it('validates Media finite nonnegative timeSeconds', () => {
    expect(validateExactSearchHitLocation({ kind: 'youtube', timeSeconds: 120 })).toHaveLength(0);
    expect(validateExactSearchHitLocation({ kind: 'audio', timeSeconds: 0 })).toHaveLength(0);

    // Negative or non-finite
    expect(validateExactSearchHitLocation({ kind: 'youtube', timeSeconds: -1 })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'audio', timeSeconds: NaN })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'audio', timeSeconds: Infinity })).toHaveLength(1);
  });

  it('validates HTML / Markdown scroll percent (0..100)', () => {
    expect(validateExactSearchHitLocation({ kind: 'html', scrollPercent: 50 })).toHaveLength(0);
    expect(validateExactSearchHitLocation({ kind: 'markdown', scrollPercent: 0 })).toHaveLength(0);
    expect(validateExactSearchHitLocation({ kind: 'markdown', scrollPercent: 100 })).toHaveLength(0);

    expect(validateExactSearchHitLocation({ kind: 'html', scrollPercent: -1 })).toHaveLength(1);
    expect(validateExactSearchHitLocation({ kind: 'markdown', scrollPercent: 101 })).toHaveLength(1);
  });

  it('enforces source-type compatibility', () => {
    // PDF document with epub jump is incompatible
    const issues = validateExactSearchHitLocation(
      { kind: 'epub', cfi: 'cfi-1' },
      'pdf'
    );
    expect(issues.some((i) => i.code === 'source_type_mismatch')).toBe(true);

    // PDF document with pdf jump is compatible
    const validIssues = validateExactSearchHitLocation(
      { kind: 'pdf', pageNumber: 1 },
      'pdf'
    );
    expect(validIssues).toHaveLength(0);
  });
});

describe('Study Source Reference Validation', () => {
  it('validates StudySourceRefInput and enforces excerpt bounds (1..1600)', () => {
    const validInput: StudySourceRefInput = {
      documentId: 'doc-1',
      excerpt: 'This is a valid source quote verifying the concept.',
      sourceType: 'pdf',
      jump: { kind: 'pdf', pageNumber: 12 },
    };
    expect(validateStudySourceRefInput(validInput).ok).toBe(true);

    // Empty excerpt
    expect(validateStudySourceRefInput({ ...validInput, excerpt: '' }).ok).toBe(false);
    expect(validateStudySourceRefInput({ ...validInput, excerpt: '   ' }).ok).toBe(false);

    // Oversized excerpt (>1600)
    const oversizedExcerpt = 'A'.repeat(STUDY_SOURCE_LIMITS.EXCERPT_MAX_CHARS + 1);
    expect(validateStudySourceRefInput({ ...validInput, excerpt: oversizedExcerpt }).ok).toBe(false);
  });

  it('validates StudySourceRefV1 and rejects forged excerptSha256', () => {
    const text = 'Direct evidence statement from the primary literature.';
    const validRef: StudySourceRefV1 = {
      schemaVersion: 1,
      id: 'ssr_12345678',
      documentId: 'doc-1',
      excerpt: text,
      revision: 'rev-content-hash-1',
      revisionKind: 'content-hash',
      excerptSha256: computeExcerptSha256(text),
      documentTitle: 'OS Concepts',
      sourceType: 'pdf',
      capturedAt: '2026-11-10T17:00:00Z',
      jump: { kind: 'pdf', pageNumber: 5 },
    };

    expect(validateStudySourceRef(validRef).ok).toBe(true);

    // Forged / mismatched hash
    const forgedRef: StudySourceRefV1 = {
      ...validRef,
      excerptSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    const forgedResult = validateStudySourceRef(forgedRef);
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) {
      expect(forgedResult.error.fieldIssues?.some((i) => i.code === 'hash_mismatch')).toBe(true);
    }
  });

  it('validates source chunk coordinates', () => {
    const inputWithValidChunk: StudySourceRefInput = {
      documentId: 'doc-1',
      excerpt: 'Chunk text',
      chunk: {
        chunkId: 'chunk-1',
        ordinal: 0,
        startOffset: 100,
        endOffset: 250,
      },
    };
    expect(validateStudySourceRefInput(inputWithValidChunk).ok).toBe(true);

    // Invalid chunk offset range (endOffset < startOffset)
    const inputWithBadChunk: StudySourceRefInput = {
      ...inputWithValidChunk,
      chunk: {
        chunkId: 'chunk-1',
        ordinal: 0,
        startOffset: 200,
        endOffset: 100,
      },
    };
    expect(validateStudySourceRefInput(inputWithBadChunk).ok).toBe(false);
  });
});
