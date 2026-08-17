import { describe, it, expect, beforeEach } from 'vitest';
import { useApiTokensStore } from '../apiTokensStore';

describe('ApiTokensStore', () => {
  beforeEach(() => {
    useApiTokensStore.setState({ tokens: [], webhooks: [], isLoading: false, error: null });
  });

  it('manages tokens locally with add and remove', () => {
    const store = useApiTokensStore.getState();
    store.addLocalToken({
      id: 'tok-1',
      name: 'Obsidian Sync Plugin',
      prefix: 'pt_live',
      scopes: ['read', 'cards:write'],
      createdAt: new Date().toISOString(),
    });

    expect(useApiTokensStore.getState().tokens).toHaveLength(1);
    expect(useApiTokensStore.getState().tokens[0].name).toBe('Obsidian Sync Plugin');

    store.removeLocalToken('tok-1');
    expect(useApiTokensStore.getState().tokens).toHaveLength(0);
  });

  it('manages webhook endpoints locally with add and remove', () => {
    const store = useApiTokensStore.getState();
    store.addLocalWebhook({
      id: 'wh-1',
      url: 'https://example.com/webhook',
      secret: 'whsec_test123',
      events: ['card.created', 'review.completed'],
      active: true,
      createdAt: new Date().toISOString(),
    });

    expect(useApiTokensStore.getState().webhooks).toHaveLength(1);
    expect(useApiTokensStore.getState().webhooks[0].url).toBe('https://example.com/webhook');

    store.removeLocalWebhook('wh-1');
    expect(useApiTokensStore.getState().webhooks).toHaveLength(0);
  });
});
