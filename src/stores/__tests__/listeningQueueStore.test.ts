import { describe, it, expect, beforeEach } from 'vitest';
import { useListeningQueueStore } from '../listeningQueueStore';

describe('ListeningQueueStore', () => {
  beforeEach(() => {
    useListeningQueueStore.getState().clearQueue();
  });

  it('enqueues items and auto-selects first item', () => {
    const store = useListeningQueueStore.getState();
    const id1 = store.enqueue({
      documentId: 'doc-1',
      title: 'Chapter 1: The Foundations of Memory',
      durationSeconds: 600,
    });

    expect(useListeningQueueStore.getState().items).toHaveLength(1);
    expect(useListeningQueueStore.getState().currentItemId).toBe(id1);

    const id2 = store.enqueue({
      documentId: 'doc-1',
      title: 'Chapter 2: Synaptic Plasticity',
      durationSeconds: 840,
    });

    expect(useListeningQueueStore.getState().items).toHaveLength(2);
    expect(useListeningQueueStore.getState().currentItemId).toBe(id1);
  });

  it('updates position and sets playing item correctly', () => {
    const store = useListeningQueueStore.getState();
    const id = store.enqueue({
      documentId: 'doc-1',
      title: 'Deep Work audiobook',
      durationSeconds: 1200,
    });

    store.setCurrentPlaying(id);
    expect(useListeningQueueStore.getState().items[0].status).toBe('playing');

    store.updatePosition(id, 345);
    expect(useListeningQueueStore.getState().items[0].currentPositionSeconds).toBe(345);
  });

  it('dequeues items and advances cursor', () => {
    const store = useListeningQueueStore.getState();
    const id1 = store.enqueue({
      documentId: 'doc-1',
      title: 'Chapter 1',
      durationSeconds: 100,
    });
    const id2 = store.enqueue({
      documentId: 'doc-1',
      title: 'Chapter 2',
      durationSeconds: 200,
    });

    store.dequeue(id1);
    expect(useListeningQueueStore.getState().items).toHaveLength(1);
    expect(useListeningQueueStore.getState().currentItemId).toBe(id2);
  });
});
