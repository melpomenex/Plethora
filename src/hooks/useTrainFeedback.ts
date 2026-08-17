/**
 * useTrainFeedback
 *
 * Shared feedback layer for every intelligence-training entry point
 * (RSS scroll quick-train, TrainingMenu context actions, SiteBySite walkthrough).
 *
 * Consolidates the gold-standard feedback pattern pioneered by
 * RSSScrollMode.handleQuickTrain into a single hook so that every
 * training action gives consistent, immediate, multi-sensory confirmation:
 *
 *   1. Distinct sound (like vs. dislike)          — respects `soundEnabled`
 *   2. Haptic vibration (no-op on unsupported devices)
 *   3. Toast with an "Undo" action that removes the just-created classifier
 *
 * Returns a `trainClassifier` function and an `onPulse` callback the caller
 * can wire to its own button-pulse visual state.
 */

import { useCallback, useRef } from "react";
import { useClassifiersStore } from "../stores/classifiersStore";
import { useToast } from "../components/common/Toast";
import { useI18n } from "../lib/i18n";
import {
  playTrainLikeSound,
  playTrainDislikeSound,
  supportsHaptics,
} from "../utils/soundService";
import {
  setRssArticleFeedback,
  type RssFeedbackSummary,
} from "../api/rss-preferences";

export type TrainSentiment = "like" | "dislike";

export interface TrainParams {
  feedId: string;
  classifierType: string;
  value: string;
  sentiment: TrainSentiment;
  scope?: string;
  /**
   * Article-level semantic feedback (OpenSpec: rss-semantic-preference-
   * learning). When provided, the same train/undo also persists/removes an
   * article feedback event so the preference profile learns from content,
   * not just the classifier dimension.
   */
  articleFeedback?: {
    articleId: string;
    summary: RssFeedbackSummary;
  };
}

export interface UseTrainFeedbackOptions {
  /**
   * Called with the sentiment immediately *before* the async write, so the
   * caller can drive a visual button pulse. Receives "like" | "dislike".
   */
  onPulse?: (sentiment: TrainSentiment) => void;
  /**
   * Called after a successful train (or undo). Lets the caller advance to
   * the next item, close a menu, etc.
   */
  onSuccess?: () => void;
  /**
   * When true, suppresses the toast (e.g. walkthrough mode shows its own UI).
   * Sound + haptic still fire.
   */
  silentToast?: boolean;
}

export function useTrainFeedback(options: UseTrainFeedbackOptions = {}) {
  const { onPulse, onSuccess, silentToast = false } = options;
  const addClassifier = useClassifiersStore((s) => s.addClassifier);
  const removeClassifier = useClassifiersStore((s) => s.removeClassifier);
  const toast = useToast();
  const { t } = useI18n();

  // Track the most recent classifier id so the undo button can target it.
  const lastCreatedId = useRef<string | null>(null);

  const triggerHaptic = useCallback(() => {
    if (supportsHaptics()) navigator.vibrate(50);
  }, []);

  const trainClassifier = useCallback(
    async (params: TrainParams): Promise<boolean> => {
      const { feedId, classifierType, value, sentiment, scope = "feed" } = params;

      // Immediate tactile + visual feedback before the async write resolves,
      // so the user knows the action registered.
      if (value) {
        if (sentiment === "like") playTrainLikeSound();
        else playTrainDislikeSound();
        triggerHaptic();
      }
      onPulse?.(sentiment);

      if (!value) {
        toast.error(t("training.cannotTrain"), t("training.cannotTrainDesc"));
        return false;
      }

      try {
        const created = await addClassifier(feedId, classifierType, value, sentiment, scope);
        lastCreatedId.current = created?.id ?? null;

        // Semantic preference write — non-fatal: classifier training must
        // succeed even when embeddings/profile are unavailable.
        if (params.articleFeedback) {
          const { articleId, summary } = params.articleFeedback;
          void (async () => {
            try {
              const { resolveEmbeddingConfigForRag } = await import(
                "../components/assistant/ragConfig"
              );
              const config = await resolveEmbeddingConfigForRag().catch(() => null);
              await setRssArticleFeedback(articleId, sentiment, summary, config);
            } catch {
              // Base classifier behavior remains intact.
            }
          })();
        }

        if (!silentToast) {
          toast.info(
            sentiment === "like" ? t("training.trainLiked") : t("training.trainDisliked"),
            t("training.trainDetail", { type: classifierType, value }),
            {
              duration: 6000,
              action: {
                label: t("training.undo"),
                onClick: () => {
                  const id = lastCreatedId.current;
                  if (!id) return;
                  void removeClassifier(id).then(() => {
                    if (params.articleFeedback) {
                      void setRssArticleFeedback(params.articleFeedback.articleId, null).catch(
                        () => undefined
                      );
                    }
                    toast.info(t("training.trainUndone"));
                  });
                },
              },
            }
          );
        }

        onSuccess?.();
        return true;
      } catch (err) {
        toast.error(
          t("training.trainFailed"),
          err instanceof Error ? err.message : String(err)
        );
        return false;
      }
    },
    [
      addClassifier,
      removeClassifier,
      toast,
      t,
      onPulse,
      onSuccess,
      silentToast,
      triggerHaptic,
    ]
  );

  return { trainClassifier };
}
