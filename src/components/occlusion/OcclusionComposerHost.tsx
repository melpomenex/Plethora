import { useCallback, useEffect, useState } from "react";
import { createLearningItemsBatch, type CreateLearningItemInput } from "../../api/learning-items";
import { recordAiProvenance } from "../../api/ai-provenance";
import { useStudyDeckStore } from "../../stores";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../common/Toast";
import { isTauri } from "../../lib/tauri";
import { ImageOcclusionComposer, type ComposerSaveResult } from "./ImageOcclusionComposer";

/**
 * Global Image Occlusion Composer host.
 *
 * Mounted once at the app shell; listens for `plethora:create-image-occlusion`
 * and opens the composer for the requested asset. Unlike the old
 * `DocumentViewer`-scoped listener this host applies no `isTabActive` /
 * `documentId` gate, so an occlusion request from any surface (document hover,
 * image registry, paste/drop, studio) opens the composer regardless of which
 * tab is active.
 *
 * Saving a session writes every card through one transactional batch command —
 * all cards are persisted or none are — and reports the whole-session result.
 * AI-assist cards carry their own question per card (task 3.6) and get an
 * `ai_provenance` row per created item (task 3.9); a provenance failure is
 * logged, never fatal.
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
    const openAsset = (assetId?: string, documentId?: string, deckId?: string) => {
      if (!assetId) return;
      setRequest({ assetId, documentId, deckId, key: Date.now() });
    };

    const handler = (event: CustomEvent<{ assetId?: string; documentId?: string; deckId?: string }>) => {
      const { assetId, documentId, deckId } = event.detail ?? {};
      openAsset(assetId, documentId, deckId);
    };
    window.addEventListener("plethora:create-image-occlusion", handler as EventListener);

    let unlistenDeepLink: (() => void) | null = null;
    let disposed = false;
    const hasTauriInvoke =
      typeof window !== "undefined" &&
      typeof (window as Window & {
        __TAURI_INTERNALS__?: { invoke?: unknown };
      }).__TAURI_INTERNALS__?.invoke === "function";
    if (isTauri() && hasTauriInvoke) {
      void import("@tauri-apps/plugin-deep-link")
        .then(async ({ getCurrent, onOpenUrl }) => {
          const openUrl = (url: string) => {
            try {
              const parsed = new URL(url);
              if (parsed.protocol !== "plethora:" || parsed.hostname !== "occlusion" || parsed.pathname !== "/create") {
                return;
              }
              openAsset(parsed.searchParams.get("assetId") ?? undefined);
            } catch {
              // Ignore unrelated or malformed external URLs.
            }
          };

          const currentUrls = await getCurrent();
          currentUrls?.forEach(openUrl);
          const remove = await onOpenUrl((urls) => urls.forEach(openUrl));
          if (disposed) remove();
          else unlistenDeepLink = remove;
        })
        .catch((error) => {
          console.warn("[occlusion] deep-link listener unavailable", error);
        });

    }
    return () => {
      disposed = true;
      unlistenDeepLink?.();
      window.removeEventListener("plethora:create-image-occlusion", handler as EventListener);
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

      // The composer prepends accepted assist card drafts to `result.cards`,
      // so the first `assistCount` entries are the AI-assist cards.
      const assistCount = result.assist?.cards.length ?? 0;
      const occlusionSetId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `occ-set-${crypto.randomUUID()}`
          : `occ-set-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const inputs: CreateLearningItemInput[] = result.cards.map((card, index) => {
        const assistCard = index < assistCount ? result.assist?.cards[index] : undefined;
        const cardQuestion = assistCard?.question ?? result.question;
        const targetRegionId = card.targetRegionId ?? card.hiddenRegions[0]?.id;
        return {
          item_type: "qa",
          question: cardQuestion,
          answer: card.answer,
          document_id: result.documentId,
          tags: deckTags,
          image_asset_ids: [result.assetId],
          interaction_metadata: {
            interactionType: "image-occlusion",
            imageOcclusionAssetId: result.assetId,
            imageOcclusionRegions: result.regions.length > 0 ? result.regions : card.hiddenRegions,
            occlusionSetId,
            targetRegionId,
            occlusionMode: result.mode,
            imageOcclusionPrompt: cardQuestion,
          },
        };
      });

      try {
        const created = await createLearningItemsBatch(inputs);
        setRequest(null);
        toast.success(
          t("occlusionComposer.savedCards", { count: created.length }),
        );

        // Provenance for AI-assist cards (task 3.9): one row per created
        // item, after the batch succeeded. Attribution is by card index (the
        // composer prepends assist drafts) or, for freeform runs, by the
        // region-id prefix. Never fatal on failure.
        const provenance = result.assist?.provenance;
        if (provenance) {
          await Promise.all(
            created.map((item, index) => {
              const isAssistCard =
                index < assistCount ||
                (provenance.usedFreeform &&
                  (item.interaction_metadata?.imageOcclusionRegions ?? []).some(
                    (region) => (region.id ?? "").startsWith("freeform-")
                  ));
              if (!isAssistCard) return Promise.resolve(null);
              return recordAiProvenance({
                targetKind: "learning_item",
                targetId: item.id,
                taskId: provenance.taskId,
                provider: provenance.providerId,
                model: provenance.baseModelName,
                modelClass: provenance.servedModelClass,
                inputFingerprint: provenance.fingerprint,
                metadata: {
                  imageAssetId: result.assetId,
                  usedFreeform: provenance.usedFreeform,
                },
              }).catch((error) => {
                console.warn("[occlusion] provenance recording failed (non-fatal)", error);
                return null;
              });
            })
          );
        }
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
