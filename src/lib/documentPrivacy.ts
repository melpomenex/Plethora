import type { Document } from "../types/document";

/** Promote legacy metadata restrictions into the authoritative DTO fields. */
export function normalizeDocumentPrivacy(document: Document): Document {
  return {
    ...document,
    isLocalOnly: document.isLocalOnly === true || document.metadata?.isLocalOnly === true,
    isAiExcluded: document.isAiExcluded === true || document.metadata?.isAiExcluded === true,
  };
}

/** A newer intentional native change wins; otherwise preserve restrictions. */
export function mergeDocumentPrivacy(current: Document, cached?: Document): Document {
  const normalized = normalizeDocumentPrivacy(current);
  if (!cached || (current.privacyVersion ?? 1) > (cached.privacyVersion ?? 1)) return normalized;
  const previous = normalizeDocumentPrivacy(cached);
  return {
    ...normalized,
    isLocalOnly: normalized.isLocalOnly || previous.isLocalOnly,
    isAiExcluded: normalized.isAiExcluded || previous.isAiExcluded,
  };
}

export type DocumentPrivacyFlags = {
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  privacyVersion: number;
};

/** Retrieve authoritative native document privacy fields, defaulting to safe local-only on missing document. */
export async function getDocumentPrivacy(documentId: string): Promise<DocumentPrivacyFlags> {
  try {
    const { getDocument } = await import("../api/documents");
    const doc = await getDocument(documentId);
    if (!doc) {
      return { isLocalOnly: true, isAiExcluded: true, privacyVersion: 1 };
    }
    const normalized = normalizeDocumentPrivacy(doc);
    return {
      isLocalOnly: Boolean(normalized.isLocalOnly),
      isAiExcluded: Boolean(normalized.isAiExcluded),
      privacyVersion: normalized.privacyVersion ?? 1,
    };
  } catch {
    return { isLocalOnly: true, isAiExcluded: true, privacyVersion: 1 };
  }
}

