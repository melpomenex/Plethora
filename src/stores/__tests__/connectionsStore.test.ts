import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionsStore } from '../connectionsStore';
import { ConnectionSuggestion } from '../../types/connections';

describe('ConnectionsStore & Anti-Spam Fingerprints', () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.getState().clearAll();
  });

  const sampleSuggestion: ConnectionSuggestion = {
    id: 'conn-1',
    relation: 'contradicts',
    leftDocumentId: 'doc-1',
    leftQuote: 'Consolidation requires rapid reactivation.',
    rightCitation: {
      documentId: 'doc-2',
      chunkId: 'chunk-9',
      quote: 'Consolidation occurs in deep slow-wave sleep.',
      locator: { type: 'pdf', page: 12 },
      score: 0.91,
    },
    score: 0.91,
    explanation: 'Differing claims regarding memory consolidation mechanisms',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  it('adds suggestions and retrieves for matching document', () => {
    useConnectionsStore.getState().addSuggestions([sampleSuggestion]);
    const forDoc = useConnectionsStore.getState().getSuggestionsForDocument('doc-1');

    expect(forDoc.length).toBe(1);
    expect(forDoc[0].id).toBe('conn-1');
  });

  it('records fingerprint on dismiss and blocks re-proposal of the same pair', () => {
    useConnectionsStore.getState().addSuggestions([sampleSuggestion]);
    useConnectionsStore.getState().dismissConnection('conn-1');

    expect(useConnectionsStore.getState().suggestions.length).toBe(0);
    expect(useConnectionsStore.getState().dismissedFingerprints.length).toBe(1);

    // Attempt to add a new suggestion with the exact same document pair and relation
    const reProposed: ConnectionSuggestion = {
      ...sampleSuggestion,
      id: 'conn-2',
    };
    useConnectionsStore.getState().addSuggestions([reProposed]);

    expect(useConnectionsStore.getState().suggestions.length).toBe(0);
  });

  it('accepts connection and updates status', () => {
    useConnectionsStore.getState().addSuggestions([sampleSuggestion]);
    useConnectionsStore.getState().acceptConnection('conn-1');

    const item = useConnectionsStore.getState().suggestions.find((s) => s.id === 'conn-1');
    expect(item?.status).toBe('accepted');
  });
});
