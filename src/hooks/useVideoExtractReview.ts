import { useContext, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { rateVideoExtract } from '../api/video-extracts';
import { patchVideoExtractCaches, videoExtractKeys } from '../lib/videoExtractQueryCache';
import { useQueueStore } from '../stores/queueStore';

type Intent = { operationId: string; rating: number; pending: boolean };
const intents = new Map<string, Intent>();
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
function notify() { revision += 1; listeners.forEach((listener) => listener()); }

/** Shared across ordinary lists and sessions, including uncertain-response retry. */
export function useVideoExtractReview() {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const queryClient = useContext(QueryClientContext);
  const rate = async (id: string, rating: number) => {
    const prior = intents.get(id);
    if (prior?.pending) return null;
    if (prior && prior.rating !== rating) throw new Error('Retry the previous extract rating before choosing another grade.');
    const intent = prior ?? { operationId: crypto.randomUUID(), rating, pending: false };
    intent.pending = true;
    intents.set(id, intent);
    notify();
    try {
      const result = await rateVideoExtract(id, rating, intent.operationId);
      intents.delete(id);
      if (queryClient) {
        if (result.extract) patchVideoExtractCaches(queryClient, result.extract);
        void queryClient.invalidateQueries({ queryKey: videoExtractKeys.all });
      }
      const queue = useQueueStore.getState();
      if (typeof queue.invalidateQueueGeneration === "function") {
        queue.invalidateQueueGeneration();
      }
      if (queue.hasCompletedFirstLoad && typeof queue.reloadForCurrentMode === "function") {
        void queue.reloadForCurrentMode();
      }
      return result;
    } finally {
      // Failed requests keep their identity so a lost response cannot double rate.
      intent.pending = false;
      notify();
    }
  };
  return { rate, isRating: (id: string) => intents.get(id)?.pending ?? false,
    retryRating: (id: string) => intents.get(id)?.rating };
}
