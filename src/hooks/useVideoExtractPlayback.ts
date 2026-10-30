import { useCallback, useEffect, useRef } from 'react';
import { markVideoExtractSeen, type VideoExtract } from '../api/video-extracts';
import { useToast } from '../components/common/Toast';

/** Selection is only an intent. A playing sample inside its segment confirms it. */
export function useVideoExtractPlayback(documentId?: string) {
  const pending = useRef<VideoExtract | null>(null);
  const toast = useToast();
  useEffect(() => { pending.current = null; }, [documentId]);
  const select = useCallback((extract: VideoExtract) => { pending.current = extract; }, []);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const confirm = useCallback((seconds: number) => {
    const extract = pending.current;
    if (!extract || !Number.isFinite(seconds) || seconds < extract.start_time - 0.25 || seconds > extract.end_time) return;
    pending.current = null;
    void markVideoExtractSeen(extract.id).then((saved) => {
      window.dispatchEvent(new CustomEvent('video-extract-seen', { detail: saved }));
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not save viewing progress. Open the segment to retry.');
    });
  }, [toast]);
  return { select, cancel, confirm };
}
