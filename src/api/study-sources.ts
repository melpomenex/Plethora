/**
 * Typed Tauri IPC wrappers for Study Sources resolution.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import type { ResolvedSourceDocument, SelectedSourceScope, StudySourceRefInput, StudySourceResolution, StudySourceScopeV1 } from '../types/studySource';
import { StudyApiError, normalizeStudyError } from './study-plans';

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study_source.error.unsupported_platform',
      retryable: false,
    });
  }
}

export async function resolveStudySourceRefs(
  input: StudySourceRefInput[]
): Promise<StudySourceResolution[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudySourceResolution[]>('resolve_study_source_refs', {
      input,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function resolveStudySourceScope(
  selected: SelectedSourceScope,
  frozenScope?: StudySourceScopeV1,
): Promise<StudySourceScopeV1> {
  ensureNativeSupport();
  const missing = () => new StudyApiError({
    code: 'missing_source',
    messageKey: 'study_generation.error.source_missing',
    retryable: false,
  });
  const wholeDocuments = new Set(frozenScope?.selected.documentIds ?? selected.documentIds);
  const extractIds = new Set(frozenScope?.selected.extractIds ?? selected.extractIds);

  if (!frozenScope) {
    const { getDocuments } = await import('./documents');
    for (const collectionId of selected.collectionIds) {
      for (const doc of await getDocuments(collectionId)) wholeDocuments.add(doc.id);
    }
    if (selected.tagIds.length) {
      const [{ getTags }, { getItemsByTag }] = await Promise.all([import('./tas'), import('./tags')]);
      const tags = await getTags();
      for (const id of selected.tagIds) {
        const tag = tags.find((candidate) => candidate.id === id);
        if (!tag) throw missing();
        for (const item of await getItemsByTag(tag.name)) {
          if (item.itemType === 'document') wholeDocuments.add(item.id);
          if (item.itemType === 'extract') extractIds.add(item.id);
        }
      }
    }
  }

  if (extractIds.size > 200) {
    throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_source.error.too_many_extracts', retryable: false });
  }
  const extractsByDocument = new Map<string, string[]>();
  if (extractIds.size > 0) {
    const { getExtract } = await import('./extracts');
    for (const id of extractIds) {
      const extract = await getExtract(id);
      if (!extract?.document_id) throw missing();
      const ids = extractsByDocument.get(extract.document_id) ?? [];
      ids.push(id);
      extractsByDocument.set(extract.document_id, ids);
    }
  }

  const documentIds = [...new Set([...wholeDocuments, ...extractsByDocument.keys()])].sort();
  if (documentIds.length > 24) {
    throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_source.error.too_many_documents', retryable: false });
  }
  const { getDocument } = await import('./documents');
  const resolvedDocuments = await Promise.all(documentIds.map(async (id): Promise<ResolvedSourceDocument> => {
    const doc = await getDocument(id);
    if (!doc) throw missing();
    return {
      documentId: id,
      title: doc.title,
      sourceType: doc.fileType,
      revision: doc.contentHash?.trim() || doc.dateModified?.trim() || 'unknown',
      revisionKind: doc.contentHash?.trim() ? 'content-hash' : doc.dateModified?.trim() ? 'modified-at' : 'unknown',
      extractIds: extractsByDocument.get(id)?.sort() ?? [],
      isAiExcluded: doc.isAiExcluded === true,
      isLocalOnly: doc.isLocalOnly === true,
    };
  }));

  return {
    schemaVersion: 1,
    selected: { ...selected, documentIds: [...wholeDocuments].sort(), extractIds: [...extractIds].sort() },
    resolvedDocuments,
    frozenAt: frozenScope?.frozenAt ?? new Date().toISOString(),
    indexCompleteness: 'unavailable',
    limitations: ['index_not_verified'],
  };
}
