import { useVideoExtractList as useVideoExtractListQuery, useDeleteVideoExtract, useSetVideoExtractQueueMembership } from './useVideoExtracts';
import { useVideoExtractReview } from './useVideoExtractReview';
import { useToast } from '../components/common/Toast';
import { useI18n } from '../lib/i18n';

/**
 * Own the source document's extract list through the shared React Query cache.
 * Creation/rating/seen/membership mutations update the same cache, so a stale
 * mount-time fetch cannot overwrite a newer committed result.
 */
export function useVideoExtractList(documentId: string) {
  const query = useVideoExtractListQuery(documentId);
  const review = useVideoExtractReview();
  const removeMutation = useDeleteVideoExtract();
  const membership = useSetVideoExtractQueueMembership();
  const toast = useToast();
  const { t } = useI18n();

  const rate = async (id: string, rating: number) => {
    try {
      return await review.rate(id, rating);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('videoExtract.failedRate'));
      return null;
    }
  };

  const remove = async (id: string) => {
    if (review.isRating(id) || !confirm(t('delete.deleteExtractConfirm'))) return;
    try {
      await removeMutation.mutateAsync(id);
      toast.success(t('videoExtract.deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('videoExtract.failedDelete'));
    }
  };

  const setQueued = async (id: string, queued: boolean, initialReviewDate?: string) => {
    try {
      await membership.mutateAsync({ extractId: id, queued, initialReviewDate });
      toast.success(queued ? t('videoExtract.addedToQueue') : t('videoExtract.removedFromQueue'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('videoExtract.failedQueueUpdate'));
    }
  };

  const reviewNow = async (id: string) => {
    await setQueued(id, true, new Date().toISOString());
  };

  return {
    extracts: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => void query.refetch(),
    rate,
    remove,
    setQueued,
    reviewNow,
    isRating: review.isRating,
    isQueueUpdating: membership.isPending,
    retryRating: review.retryRating,
  };
}
