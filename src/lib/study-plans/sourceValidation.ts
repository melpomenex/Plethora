/**
 * Source DTO Validation, Locator Verification, and Canonical Hashing.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §1, §2
 * - openspec/changes/establish-persistent-study-plans/
 */

import type { ExactSearchHitLocation } from '../../types/searchHit';
import type {
  SelectedSourceScope,
  StudySourceScopeV1,
  StudySourceRefInput,
  StudySourceRefV1,
  StudySourceChunk,
} from '../../types/studySource';
import type {
  StudyResult,
  FieldIssue,
} from '../../types/learningPaths';

export const STUDY_SOURCE_LIMITS = {
  MAX_SOURCE_DOCUMENTS: 24,
  MAX_SOURCE_EXTRACTS: 200,
  EXCERPT_MIN_CHARS: 1,
  EXCERPT_MAX_CHARS: 1600,
  SECTION_LABEL_MAX_CHARS: 240,
} as const;

// ============================================================================
// 1. Synchronous Deterministic SHA-256 and Canonical JSON
// ============================================================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Computes deterministic lowercase 64-char hex SHA-256 string for any input string.
 */
export function sha256Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padZeros = (64 - ((withOne + 8) % 64)) % 64;
  const totalLength = withOne + padZeros + 8;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  view.setUint32(totalLength - 8, highBits, false);
  view.setUint32(totalLength - 4, lowBits, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i += 1) {
    hex += h[i].toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * Normalizes live excerpt text (CRLF -> LF) and calculates SHA-256 formatted as `sha256:<64 hex>`.
 */
export function computeExcerptSha256(excerpt: string): string {
  const normalized = excerpt.replace(/\r\n/g, '\n');
  return `sha256:${sha256Hex(normalized)}`;
}

/**
 * Recursively serializes a value to Canonical JSON:
 * - Object keys sorted alphabetically
 * - Strings NFC normalized
 * - Array element order preserved
 * - Rejects non-finite numbers, functions, and undefined
 */
export function toCanonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number not allowed in canonical JSON: ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value.normalize('NFC'));
  }
  if (Array.isArray(value)) {
    const elements = value.map((el) => {
      if (el === undefined || typeof el === 'function' || typeof el === 'symbol') {
        return 'null';
      }
      return toCanonicalJson(el);
    });
    return `[${elements.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs: string[] = [];
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
        continue;
      }
      pairs.push(`${JSON.stringify(key.normalize('NFC'))}:${toCanonicalJson(v)}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Unsupported value type in canonical JSON: ${typeof value}`);
}

/**
 * Computes canonical SHA-256 fingerprint formatted as `sha256:<64 hex>`.
 */
export function computeCanonicalHash(value: unknown): string {
  return `sha256:${sha256Hex(toCanonicalJson(value))}`;
}

// ============================================================================
// 2. Scope Validation
// ============================================================================

export function validateSelectedSourceScope(
  selected: SelectedSourceScope
): StudyResult<void> {
  const issues: FieldIssue[] = [];

  const uniqueDocs = new Set(selected.documentIds || []);
  if (uniqueDocs.size > STUDY_SOURCE_LIMITS.MAX_SOURCE_DOCUMENTS) {
    issues.push({
      path: 'documentIds',
      code: 'max_documents_exceeded',
      messageKey: 'study_source.error.max_documents_exceeded',
    });
  }

  const uniqueExtracts = new Set(selected.extractIds || []);
  if (uniqueExtracts.size > STUDY_SOURCE_LIMITS.MAX_SOURCE_EXTRACTS) {
    issues.push({
      path: 'extractIds',
      code: 'max_extracts_exceeded',
      messageKey: 'study_source.error.max_extracts_exceeded',
    });
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_source.error.invalid_source_scope',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}

export function validateStudySourceScope(
  scope: StudySourceScopeV1
): StudyResult<void> {
  const issues: FieldIssue[] = [];

  if (scope.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: 'unsupported_version',
        messageKey: 'study_source.error.unsupported_version',
        retryable: false,
      },
    };
  }

  if (!scope.resolvedDocuments || scope.resolvedDocuments.length === 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_source.error.empty_source_scope',
        retryable: false,
        fieldIssues: [{
          path: 'resolvedDocuments',
          code: 'empty_source_scope',
          messageKey: 'study_source.error.empty_source_scope',
        }],
      },
    };
  }

  if (scope.resolvedDocuments.length > STUDY_SOURCE_LIMITS.MAX_SOURCE_DOCUMENTS) {
    issues.push({
      path: 'resolvedDocuments',
      code: 'max_documents_exceeded',
      messageKey: 'study_source.error.max_documents_exceeded',
    });
  }

  // Verify documents are sorted by documentId at freeze
  for (let i = 0; i < scope.resolvedDocuments.length; i++) {
    const doc = scope.resolvedDocuments[i];
    if (!doc.documentId || doc.documentId.trim() === '') {
      issues.push({
        path: `resolvedDocuments[${i}].documentId`,
        code: 'required_field',
        messageKey: 'study_source.error.required_document_id',
      });
    }

    if (!doc.revision || doc.revision.trim() === '') {
      issues.push({
        path: `resolvedDocuments[${i}].revision`,
        code: 'required_field',
        messageKey: 'study_source.error.required_revision',
      });
    }

    if (i > 0) {
      const prevDoc = scope.resolvedDocuments[i - 1];
      if (prevDoc.documentId.localeCompare(doc.documentId) > 0) {
        issues.push({
          path: 'resolvedDocuments',
          code: 'documents_not_sorted',
          messageKey: 'study_source.error.documents_not_sorted',
        });
      }
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_source.error.validation_failed',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}

// ============================================================================
// 3. Exact Locator and Jump Validation
// ============================================================================

export function validateExactSearchHitLocation(
  jump: ExactSearchHitLocation,
  sourceType?: string,
  pathPrefix = 'jump'
): FieldIssue[] {
  const issues: FieldIssue[] = [];

  // Check source-type compatibility if sourceType provided
  if (sourceType) {
    const normalizedSource = sourceType.toLowerCase().trim();
    if (['pdf', 'epub', 'html', 'markdown', 'youtube', 'audio'].includes(normalizedSource)) {
      if (jump.kind !== normalizedSource) {
        issues.push({
          path: `${pathPrefix}.kind`,
          code: 'source_type_mismatch',
          messageKey: 'study_source.error.source_type_mismatch',
        });
      }
    }
  }

  switch (jump.kind) {
    case 'pdf': {
      if (
        typeof jump.pageNumber !== 'number' ||
        !Number.isInteger(jump.pageNumber) ||
        jump.pageNumber < 1
      ) {
        issues.push({
          path: `${pathPrefix}.pageNumber`,
          code: 'invalid_pdf_page',
          messageKey: 'study_source.error.invalid_pdf_page',
        });
      }
      if (jump.textOffsetHint !== undefined) {
        if (
          typeof jump.textOffsetHint !== 'number' ||
          !Number.isInteger(jump.textOffsetHint) ||
          jump.textOffsetHint < 0
        ) {
          issues.push({
            path: `${pathPrefix}.textOffsetHint`,
            code: 'invalid_offset_hint',
            messageKey: 'study_source.error.invalid_offset_hint',
          });
        }
      }
      break;
    }
    case 'epub': {
      if (!jump.cfi || typeof jump.cfi !== 'string' || jump.cfi.trim() === '') {
        issues.push({
          path: `${pathPrefix}.cfi`,
          code: 'invalid_epub_cfi',
          messageKey: 'study_source.error.invalid_epub_cfi',
        });
      }
      if (jump.matchIndex !== undefined) {
        if (typeof jump.matchIndex !== 'number' || jump.matchIndex < 0) {
          issues.push({
            path: `${pathPrefix}.matchIndex`,
            code: 'invalid_match_index',
            messageKey: 'study_source.error.invalid_match_index',
          });
        }
      }
      break;
    }
    case 'youtube':
    case 'audio': {
      if (
        typeof jump.timeSeconds !== 'number' ||
        !Number.isFinite(jump.timeSeconds) ||
        jump.timeSeconds < 0
      ) {
        issues.push({
          path: `${pathPrefix}.timeSeconds`,
          code: 'invalid_media_time',
          messageKey: 'study_source.error.invalid_media_time',
        });
      }
      break;
    }
    case 'html':
    case 'markdown': {
      if (jump.scrollPercent !== undefined) {
        if (
          typeof jump.scrollPercent !== 'number' ||
          !Number.isFinite(jump.scrollPercent) ||
          jump.scrollPercent < 0 ||
          jump.scrollPercent > 100
        ) {
          issues.push({
            path: `${pathPrefix}.scrollPercent`,
            code: 'invalid_scroll_percent',
            messageKey: 'study_source.error.invalid_scroll_percent',
          });
        }
      }
      break;
    }
    default: {
      issues.push({
        path: `${pathPrefix}.kind`,
        code: 'unsupported_locator_kind',
        messageKey: 'study_source.error.unsupported_locator_kind',
      });
    }
  }

  if (jump.textQuote !== undefined) {
    if (typeof jump.textQuote !== 'string' || jump.textQuote.length > STUDY_SOURCE_LIMITS.EXCERPT_MAX_CHARS) {
      issues.push({
        path: `${pathPrefix}.textQuote`,
        code: 'invalid_quote_length',
        messageKey: 'study_source.error.invalid_quote_length',
      });
    }
  }

  return issues;
}

// ============================================================================
// 4. Study Source Ref Validation
// ============================================================================

export function validateStudySourceRefInput(
  input: StudySourceRefInput
): StudyResult<void> {
  const issues: FieldIssue[] = [];

  if (!input.documentId || input.documentId.trim() === '') {
    issues.push({
      path: 'documentId',
      code: 'required_field',
      messageKey: 'study_source.error.required_document_id',
    });
  }

  const normalizedExcerpt = (input.excerpt || '').replace(/\r\n/g, '\n');
  if (
    normalizedExcerpt.length < STUDY_SOURCE_LIMITS.EXCERPT_MIN_CHARS ||
    normalizedExcerpt.length > STUDY_SOURCE_LIMITS.EXCERPT_MAX_CHARS ||
    normalizedExcerpt.trim().length === 0
  ) {
    issues.push({
      path: 'excerpt',
      code: 'invalid_excerpt_length',
      messageKey: 'study_source.error.invalid_excerpt_length',
    });
  }

  if (input.sectionLabel && input.sectionLabel.length > STUDY_SOURCE_LIMITS.SECTION_LABEL_MAX_CHARS) {
    issues.push({
      path: 'sectionLabel',
      code: 'invalid_section_label_length',
      messageKey: 'study_source.error.invalid_section_label_length',
    });
  }

  if (input.jump) {
    issues.push(...validateExactSearchHitLocation(input.jump, input.sourceType, 'jump'));
  }

  if (input.chunk) {
    issues.push(...validateStudySourceChunk(input.chunk, 'chunk'));
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_source.error.validation_failed',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}

export function validateStudySourceChunk(
  chunk: StudySourceChunk,
  pathPrefix = 'chunk'
): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!chunk.chunkId || chunk.chunkId.trim() === '') {
    issues.push({
      path: `${pathPrefix}.chunkId`,
      code: 'required_field',
      messageKey: 'study_source.error.required_chunk_id',
    });
  }

  if (typeof chunk.ordinal !== 'number' || chunk.ordinal < 0) {
    issues.push({
      path: `${pathPrefix}.ordinal`,
      code: 'invalid_ordinal',
      messageKey: 'study_source.error.invalid_ordinal',
    });
  }

  if (typeof chunk.startOffset !== 'number' || chunk.startOffset < 0) {
    issues.push({
      path: `${pathPrefix}.startOffset`,
      code: 'invalid_offset',
      messageKey: 'study_source.error.invalid_offset',
    });
  }

  if (
    typeof chunk.endOffset !== 'number' ||
    chunk.endOffset < 0 ||
    chunk.endOffset < chunk.startOffset
  ) {
    issues.push({
      path: `${pathPrefix}.endOffset`,
      code: 'invalid_offset_range',
      messageKey: 'study_source.error.invalid_offset_range',
    });
  }

  return issues;
}

export function validateStudySourceRef(
  ref: StudySourceRefV1
): StudyResult<void> {
  const issues: FieldIssue[] = [];

  if (ref.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: 'unsupported_version',
        messageKey: 'study_source.error.unsupported_version',
        retryable: false,
      },
    };
  }

  if (!ref.id || ref.id.trim() === '') {
    issues.push({
      path: 'id',
      code: 'required_field',
      messageKey: 'study_source.error.required_id',
    });
  }

  if (!ref.documentId || ref.documentId.trim() === '') {
    issues.push({
      path: 'documentId',
      code: 'required_field',
      messageKey: 'study_source.error.required_document_id',
    });
  }

  if (!ref.revision || ref.revision.trim() === '') {
    issues.push({
      path: 'revision',
      code: 'required_field',
      messageKey: 'study_source.error.required_revision',
    });
  }

  if (!['content-hash', 'modified-at', 'unknown'].includes(ref.revisionKind)) {
    issues.push({
      path: 'revisionKind',
      code: 'invalid_revision_kind',
      messageKey: 'study_source.error.invalid_revision_kind',
    });
  }

  const normalizedExcerpt = (ref.excerpt || '').replace(/\r\n/g, '\n');
  if (
    normalizedExcerpt.length < STUDY_SOURCE_LIMITS.EXCERPT_MIN_CHARS ||
    normalizedExcerpt.length > STUDY_SOURCE_LIMITS.EXCERPT_MAX_CHARS ||
    normalizedExcerpt.trim().length === 0
  ) {
    issues.push({
      path: 'excerpt',
      code: 'invalid_excerpt_length',
      messageKey: 'study_source.error.invalid_excerpt_length',
    });
  }

  const expectedSha = computeExcerptSha256(ref.excerpt);
  if (ref.excerptSha256 !== expectedSha) {
    issues.push({
      path: 'excerptSha256',
      code: 'hash_mismatch',
      messageKey: 'study_source.error.hash_mismatch',
    });
  }

  if (!ref.capturedAt || ref.capturedAt.trim() === '') {
    issues.push({
      path: 'capturedAt',
      code: 'required_field',
      messageKey: 'study_source.error.required_captured_at',
    });
  }

  if (ref.jump) {
    issues.push(...validateExactSearchHitLocation(ref.jump, ref.sourceType, 'jump'));
  }

  if (ref.chunk) {
    issues.push(...validateStudySourceChunk(ref.chunk, 'chunk'));
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        messageKey: 'study_source.error.validation_failed',
        retryable: false,
        fieldIssues: issues,
      },
    };
  }

  return { ok: true, value: undefined };
}
