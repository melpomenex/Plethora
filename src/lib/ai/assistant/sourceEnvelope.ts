import { getDocument } from '../../../api/documents';
import { getExtract } from '../../../api/extracts';
import type { Document } from '../../../types/document';

export interface FrozenAssistantSource {
  readonly kind: 'document' | 'extract';
  readonly documentId: string;
  readonly extractId?: string;
  readonly contextKey: string;
  readonly collectionId?: string;
  readonly contentRevision?: string;
  readonly extractRevision?: string;
  readonly privacyDocumentIds: readonly string[];
}

export interface AssistantSourceReference {
  documentId?: string;
  extractId?: string;
  contextKey?: string;
}

/** Capture scalar values, never retain a mutable document/store object. */
export function freezeAssistantSource(
  document: Pick<Document, 'id' | 'collectionId' | 'contentHash'>,
  extract?: { id: string; document_id: string; date_modified?: string },
  contextKey?: string,
): FrozenAssistantSource {
  if (('_deleted' in document && document._deleted === true) || ('Deleted' in document && document.Deleted === true)) {
    throw new Error('The selected source document no longer exists.');
  }
  if (!document.id || document.id.startsWith('extract:') || (extract && extract.document_id !== document.id)) {
    throw new Error('The selected source no longer matches its document. Reselect it before creating cards.');
  }
  return Object.freeze({
    kind: extract ? 'extract' : 'document', documentId: document.id, extractId: extract?.id,
    contextKey: contextKey ?? (extract ? `extract:${extract.id}` : document.id),
    collectionId: document.collectionId, contentRevision: document.contentHash || undefined,
    extractRevision: extract?.date_modified,
    privacyDocumentIds: Object.freeze([document.id]),
  });
}

/** Legacy display namespaces resolve by reading the actual stored relationship. */
export async function resolveAssistantSource(
  reference: AssistantSourceReference,
  loaders = { getDocument, getExtract },
): Promise<FrozenAssistantSource | undefined> {
  const displayId = reference.documentId;
  const extractId = reference.extractId ?? (displayId?.startsWith('extract:') ? displayId.slice('extract:'.length) : undefined);
  if (!displayId && !extractId) return undefined;
  const extract = extractId ? await loaders.getExtract(extractId) : undefined;
  if (extractId && (!extract || ('_deleted' in extract && extract._deleted === true))) {
    throw new Error('The selected extract no longer exists. Reselect a source before creating cards.');
  }
  const documentId = extract?.document_id ?? displayId;
  if (!documentId || (displayId && !displayId.startsWith('extract:') && displayId !== documentId)) {
    throw new Error('The selected extract belongs to another document. Reselect the source.');
  }
  const document = await loaders.getDocument(documentId);
  if (!document || ('_deleted' in document && document._deleted === true)) {
    throw new Error('The selected source document no longer exists.');
  }
  return freezeAssistantSource(document, extract ?? undefined, reference.contextKey ?? displayId);
}
