import { describe, expect, it, vi } from 'vitest';
import { freezeAssistantSource, resolveAssistantSource } from '../sourceEnvelope';
import { normalizeAssistantToolParameters } from '../toolCallParser';
import type { Document } from '../../../../types/document';
import type { Extract } from '../../../../api/extracts';

function loaders() {
  return {
    getDocument: vi.fn(async (id: string) => ({ id, contentHash: 'revision', collectionId: 'collection' } as Document)),
    getExtract: vi.fn(async (id: string) => ({ id, document_id: 'parent', date_modified: '2026-10-30T00:00:00Z' } as Extract)),
  };
}

describe('frozen Assistant source identity', () => {
  it('resolves a display namespace through the stored extract relationship', async () => {
    const reads = loaders();
    const source = await resolveAssistantSource({ documentId: 'extract:segment' }, reads);
    expect(reads.getExtract).toHaveBeenCalledWith('segment');
    expect(reads.getDocument).toHaveBeenCalledWith('parent');
    expect(source).toMatchObject({ kind: 'extract', documentId: 'parent', extractId: 'segment', contextKey: 'extract:segment', privacyDocumentIds: ['parent'] });
    const parameters = normalizeAssistantToolParameters('batch_create_cards', { document_id: 'invented', cards: [{ question: 'Q', document_id: 'wrong', extract_id: 'wrong' }] }, { sourceEnvelope: source });
    expect(parameters).toMatchObject({ document_id: 'parent', extract_id: 'segment', source_revision: 'revision', cards: [{ document_id: 'parent', extract_id: 'segment' }] });
  });

  it('captures values independently of later store mutations', () => {
    const document = { id: 'parent', contentHash: 'old', collectionId: 'one' };
    const source = freezeAssistantSource(document);
    document.id = 'another'; document.contentHash = 'new';
    expect(source.documentId).toBe('parent');
    expect(source.contentRevision).toBe('old');
    expect(Object.isFrozen(source.privacyDocumentIds)).toBe(true);
  });

  it('rejects missing/deleted/mismatched sources and unresolved tool namespaces', async () => {
    const reads = loaders();
    await expect(resolveAssistantSource({ documentId: 'wrong', extractId: 'segment' }, reads)).rejects.toThrow('another document');
    reads.getExtract.mockResolvedValueOnce(null);
    await expect(resolveAssistantSource({ documentId: 'extract:deleted' }, reads)).rejects.toThrow('no longer exists');
    expect(() => normalizeAssistantToolParameters('create_qa_card', { question: 'Q', answer: 'A' }, { documentId: 'extract:segment' })).toThrow('Resolve the extract');
  });

  it('leaves genuinely source-free conversations source-free', async () => {
    const reads = loaders();
    expect(await resolveAssistantSource({}, reads)).toBeUndefined();
    expect(reads.getDocument).not.toHaveBeenCalled();
    expect(reads.getExtract).not.toHaveBeenCalled();
  });
});
