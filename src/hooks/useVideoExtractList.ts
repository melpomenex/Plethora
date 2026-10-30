import { useEffect, useRef, useState } from 'react';
import { deleteVideoExtract, getVideoExtracts, type VideoExtract, type VideoExtractReviewResult } from '../api/video-extracts';
import { useToast } from '../components/common/Toast';
import { useI18n } from '../lib/i18n';
import { useVideoExtractReview } from './useVideoExtractReview';

/** Reconcile committed records over an older list response, by source identity. */
export function useVideoExtractList(documentId: string) {
  const [extracts, setExtracts] = useState<VideoExtract[]>([]);
  const [loading, setLoading] = useState(true);
  const review = useVideoExtractReview();
  const toast = useToast();
  const { t } = useI18n();
  const feedback = useRef({ toast, t });
  feedback.current = { toast, t };
  const committed = useRef(new Map<string, VideoExtract | null>());
  useEffect(() => {
    let active = true;
    committed.current.clear();
    setLoading(true);
    const reconcile = (event: Event) => {
      const { extract, receipt } = (event as CustomEvent<VideoExtractReviewResult>).detail;
      if (receipt.document_id !== documentId) return;
      committed.current.set(receipt.extract_id, extract);
      setExtracts((items) => items.flatMap((item) => item.id !== receipt.extract_id ? [item] : extract ? [extract] : []));
    };
    const seen = (event: Event) => {
      const saved = (event as CustomEvent<VideoExtract>).detail;
      if (saved.document_id !== documentId) return;
      const patch = (item: VideoExtract) => ({ ...item, first_seen_at: saved.first_seen_at, last_seen_at: saved.last_seen_at });
      const prior = committed.current.get(saved.id);
      committed.current.set(saved.id, prior === null ? null : patch(prior ?? saved));
      setExtracts((items) => items.map((item) => item.id === saved.id ? patch(item) : item));
    };
    window.addEventListener('video-extract-reviewed', reconcile);
    window.addEventListener('video-extract-seen', seen);
    void getVideoExtracts(documentId).then((data) => {
      if (!active) return;
      setExtracts(data.flatMap((item) => {
        const saved = committed.current.get(item.id);
        return saved === null ? [] : [saved ?? item];
      }));
    }).catch((error: unknown) => {
      if (active) feedback.current.toast.error(error instanceof Error ? error.message : feedback.current.t('videoExtract.failedLoad'));
    }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      window.removeEventListener('video-extract-reviewed', reconcile);
      window.removeEventListener('video-extract-seen', seen);
    };
  }, [documentId]);
  const rate = async (id: string, rating: number) => {
    try { await review.rate(id, rating); }
    catch (error) { toast.error(error instanceof Error ? error.message : t('videoExtract.failedRate')); }
  };
  const remove = async (id: string) => {
    if (review.isRating(id) || !confirm(t('delete.deleteExtractConfirm'))) return;
    try {
      await deleteVideoExtract(id);
      committed.current.set(id, null);
      setExtracts((items) => items.filter((item) => item.id !== id));
      toast.success(t('videoExtract.deleted'));
    } catch (error) { toast.error(error instanceof Error ? error.message : t('videoExtract.failedDelete')); }
  };
  return { extracts, loading, rate, remove, isRating: review.isRating, retryRating: review.retryRating };
}
