import { useCallback, useEffect, useState } from "react";
import { createLearningItemsBatch, type CreateLearningItemInput } from "../../api/learning-items";
import { useStudyDeckStore } from "../../stores";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../common/Toast";
import { ImageOcclusionComposer, type ComposerSaveResult } from "./ImageOcclusionComposer";

/**
 * Global Image Occlusion Composer host.
 *
 * Mounted once at the app shell; listens for `incrementum:create-image-occlusion`
 * and opens the composer for the requested asset. Unlike the old
 * `DocumentViewer`-scoped listener this host applies no `isTabActive` /
 * `documentId` gate, so an occlusion request from any surface (document hover,
 * image registry, paste/drop, studio) opens the composer regardless of which
 * tab is active.
 *
 * Saving a session writes every card through one transactional batch command —
 * all cards are persisted or none are — and reports the whole-session result.
 */
interface OcclusionComposerRequest {
  assetId: string;
  documentId?: string;
  deckId?: string;
  key: number;
}

export function OcclusionComposerHost() {
  const { t } = useI18n();
  const toast = useToast();
  const decks = useStudyDeckStore((state) => state.decks);
  const [request, setRequest] = useState<OcclusionComposerRequest | null>(null);

  useEffect(() => {
    const handler = (event: CustomEvent<{ assetId?: string; documentId?: string; deckId?: string }>) => {
      const { assetId, documentId, deckId } = event.detail ?? {};
      if (!assetId) return;
      setRequest({ assetId, documentId, deckId, key: Date.now() });
    };
    window.addEventListener("incrementum:create-image-occlusion", handler as EventListener);
    return () => {
      window.removeEventListener("incrementum:create-image-occlusion", handler as EventListener);
    };
  }, []);

  const handleSave = useCallback(
    async (result: ComposerSaveResult) => {
      const deck = result.deckId ? decks.find((d) => d.id === result.deckId) : undefined;
      const deckTags = deck
        ? deck.tagFilters.length > 0
          ? deck.tagFilters
          : [deck.name]
        : [];

      const inputs: CreateLearningItemInput[] = result.cards.map((card) => ({
        item_type: "qa",
        question: result.question,
        answer: card.answer,
        document_id: result.documentId,
        tags: deckTags,
        image_asset_ids: [result.assetId],
        interaction_metadata: {
          interactionType: "image-occlusion",
          imageOcclusionAssetId: result.assetId,
          imageOcclusionRegions: card.hiddenRegions,
          imageOcclusionPrompt: result.question,
        },
      }));

      try {
        const created = await createLearningItemsBatch(inputs);
        setRequest(null);
        toast.success(
          t("occlusionComposer.savedCards", { count: created.length }),
        );
      } catch (error) {
        // Whole-session failure: nothing was persisted; stay in the composer
        // so the authoring work is not lost.
        toast.error(
          t("occlusionComposer.saveFailed"),
          error instanceof Error ? error.message : undefined,
        );
      }
    },
    [decks, t, toast],
  );

  if (!request) return null;

  return (
    <ImageOcclusionComposer
      key={request.key}
      assetId={request.assetId}
      documentId={request.documentId}
      deckId={request.deckId}
      onSave={(result) => void handleSave(result)}
      onCancel={() => setRequest(null)}
    />
  );
}
