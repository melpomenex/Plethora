import { useSyncExternalStore } from 'react';
import { rateVideoExtract } from '../api/video-extracts';

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
      window.dispatchEvent(new CustomEvent('video-extract-reviewed', { detail: result }));
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
