import { describe, it, expect, beforeEach } from 'vitest';
import { useInboxStore } from '../inboxStore';

describe('InboxStore', () => {
  beforeEach(() => {
    useInboxStore.getState().clearInbox();
  });

  it('adds remote capture items in pending status', () => {
    const store = useInboxStore.getState();
    const id = store.addItem({
      url: 'https://example.com/essay.html',
      title: 'Attention is All You Need',
      tags: ['ai', 'transformers'],
    });

    const items = useInboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(items[0].status).toBe('pending');
    expect(items[0].title).toBe('Attention is All You Need');
  });

  it('accepts and dismisses inbox items cleanly', () => {
    const store = useInboxStore.getState();
    const id = store.addItem({
      url: 'https://example.com/spaced_repetition.html',
      title: 'Spaced Repetition Systems',
      tags: ['memory'],
    });

    store.acceptItem(id);
    expect(useInboxStore.getState().items[0].status).toBe('accepted');

    store.dismissItem(id);
    expect(useInboxStore.getState().items[0].status).toBe('dismissed');
  });
});
