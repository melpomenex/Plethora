import { useCallback, useContext, useEffect, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { markVideoExtractSeen, type VideoExtract } from '../api/video-extracts';
import { useToast } from '../components/common/Toast';
import { patchVideoExtractCaches, videoExtractKeys } from '../lib/videoExtractQueryCache';

/** Selection is only an intent. A playing sample inside its segment confirms it. */
export function useVideoExtractPlayback(documentId?: string, armedExtract?: VideoExtract | null) {
  const pending = useRef<VideoExtract | null>(null);
  const toast = useToast();
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    pending.current = armedExtract ?? null;
  }, [armedExtract?.id, armedExtract?.document_id]);

  const lastDocumentRef = useRef(documentId);
  useEffect(() => {
    if (lastDocumentRef.current !== documentId) pending.current = null;
    lastDocumentRef.current = documentId;
  }, [documentId]);

  const select = useCallback((extract: VideoExtract) => { pending.current = extract; }, []);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const confirm = useCallback((seconds: number) => {
    const extract = pending.current;
    if (!extract || !Number.isFinite(seconds) || seconds < extract.start_time - 0.25 || seconds > extract.end_time) return;
    pending.current = null;
    void markVideoExtractSeen(extract.id).then((saved) => {
      if (queryClient) {
        patchVideoExtractCaches(queryClient, saved);
        void queryClient.invalidateQueries({ queryKey: videoExtractKeys.all });
      }
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not save viewing progress. Open the segment to retry.');
    });
  }, [queryClient, toast]);
  return { select, cancel, confirm };
}
