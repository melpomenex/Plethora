import { useEffect, useRef, useState } from "react";
import { getVideoExtracts, type VideoExtract } from "../api/video-extracts";
import { useToast } from "../components/common/Toast";
import { useSettingsStore } from "../stores/settingsStore";
import { useVideoExtractReview } from "./useVideoExtractReview";
import { useI18n } from "../lib/i18n";

/** Own the due-list load, one rating at a time, and session advancement. */
export function useDueVideoReview(documentId?: string, onComplete?: () => void) {
  const [extracts, setExtracts] = useState<VideoExtract[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isRating, setIsRating] = useState(false);
  const ratingInFlight = useRef<symbol | null>(null);
  const generationRef = useRef(0);
  const toast = useToast();
  const controller = useVideoExtractReview();
  const committed = useRef(new Set<string>());
  const { t } = useI18n();

  useEffect(() => {
    const generation = ++generationRef.current;
    ratingInFlight.current = null;
    setIsRating(false);
    setCurrentIndex(0);
    committed.current.clear();
    setLoading(true);
    void (async () => {
      try {
        const allExtracts = documentId ? await getVideoExtracts(documentId) : [];
        const now = new Date();
        const limits = useSettingsStore.getState().settings.learning;
        const due = [
          ...allExtracts.filter((e) => e.review_count > 0 && e.next_review_date && new Date(e.next_review_date) <= now).slice(0, limits.reviewsPerDay),
          ...allExtracts.filter((e) => e.review_count === 0).slice(0, limits.newCardsPerDay),
        ];
        if (generation === generationRef.current) setExtracts(due);
      } catch (err) {
        if (generation === generationRef.current) toast.error(err instanceof Error ? err.message : t("videoExtract.failedLoadDue"));
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    })();
    return () => { generationRef.current += 1; };
  }, [documentId]);

  const rate = async (extractId: string, rating: number) => {
    const current = extracts[currentIndex];
    if (!current || current.id !== extractId || ratingInFlight.current || committed.current.has(extractId)) return;
    const token = Symbol("video-extract-rating");
    const generation = generationRef.current;
    ratingInFlight.current = token;
    setIsRating(true);
    try {
      const result = await controller.rate(extractId, rating);
      if (!result || generation !== generationRef.current) return;
      committed.current.add(extractId);
      if (currentIndex < extracts.length - 1) setCurrentIndex(currentIndex + 1);
      else { setCurrentIndex(extracts.length); onComplete?.(); }
    } catch (err) {
      if (generation === generationRef.current) toast.error(err instanceof Error ? err.message : t("videoExtract.failedRate"));
    } finally {
      if (ratingInFlight.current === token) {
        ratingInFlight.current = null;
        setIsRating(false);
      }
    }
  };
  return { extracts, currentIndex, loading, isRating: isRating || controller.isRating(extracts[currentIndex]?.id ?? ""), rate, retryRating: controller.retryRating };
}
