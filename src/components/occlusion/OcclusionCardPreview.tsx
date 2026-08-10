import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { ImageAsset } from "../../api/image-registry";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import { expandRegionsToCards, type OcclusionMode } from "../../utils/occlusion";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

/**
 * Review-accurate preview of the cards a session will produce.
 *
 * Driven by the same pure function the save path uses (`expandRegionsToCards`),
 * so the preview can never drift from what actually gets saved. The front face
 * is the masked image (same rendering approach as `OcclusionLightbox`); the
 * back face reveals the image and shows the answer, which is editable here and
 * takes precedence over the region label when supplied.
 */
export interface OcclusionPreviewAnswers {
  /** Explicit answers per region id (per-region mode). */
  byRegionId: Record<string, string>;
  /** Explicit answer for the single hide-all card. */
  hideAll?: string;
}

export const EMPTY_PREVIEW_ANSWERS: OcclusionPreviewAnswers = { byRegionId: {} };

export interface OcclusionCardPreviewProps {
  asset: ImageAsset | null;
  regions: ImageOcclusionRegion[];
  mode: OcclusionMode;
  answers: OcclusionPreviewAnswers;
  onAnswersChange: (answers: OcclusionPreviewAnswers) => void;
}

export function OcclusionCardPreview({
  asset,
  regions,
  mode,
  answers,
  onAnswersChange,
}: OcclusionCardPreviewProps) {
  const { t } = useI18n();
  const cards = useMemo(
    () =>
      expandRegionsToCards(regions, mode, {
        answersByRegionId: answers.byRegionId,
        answer: answers.hideAll,
      }),
    [regions, mode, answers],
  );
  const total = cards.length;

  const [index, setIndex] = useState(0);
  const [face, setFace] = useState<"front" | "back">("front");

  // Clamp the stepper when regions/mode changes shrink the card count.
  useEffect(() => {
    if (index >= total && total > 0) setIndex(total - 1);
    if (total === 0) setIndex(0);
  }, [index, total]);

  if (!asset || total === 0) {
    return (
      <div className="flex h-full min-h-[10rem] items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
        {t("occlusionComposer.noRegionsYet")}
      </div>
    );
  }

  const card = cards[index];
  const hidden = card.hiddenRegions;
  const hiddenRegionId = hidden[0]?.id ?? "";
  const explicitAnswer =
    mode === "hide-all" ? answers.hideAll ?? "" : answers.byRegionId[hiddenRegionId] ?? "";
  const label = mode === "hide-all" ? undefined : hidden[0]?.label;

  const setExplicitAnswer = (value: string) => {
    if (mode === "hide-all") {
      onAnswersChange({ ...answers, hideAll: value });
    } else {
      onAnswersChange({ ...answers, byRegionId: { ...answers.byRegionId, [hiddenRegionId]: value } });
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="occlusion-preview">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("occlusionComposer.cardStep", { index: index + 1, total })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("occlusionComposer.frontFace")}
            onClick={() => setFace("front")}
            className={cn(
              "rounded-md px-2 py-1 font-medium",
              face === "front" ? "bg-primary/15 text-primary" : "hover:bg-muted",
            )}
          >
            {t("occlusionComposer.frontFace")}
          </button>
          <button
            type="button"
            aria-label={t("occlusionComposer.backFace")}
            onClick={() => setFace("back")}
            className={cn(
              "rounded-md px-2 py-1 font-medium",
              face === "back" ? "bg-primary/15 text-primary" : "hover:bg-muted",
            )}
          >
            {t("occlusionComposer.backFace")}
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-black/40">
        <img
          src={asset.data_url}
          alt={asset.file_name || "preview"}
          className="block w-full object-contain"
          draggable={false}
        />
        {face === "front" &&
          hidden.map((region, i) => (
            <div
              key={region.id || i}
              data-testid="occlusion-preview-mask"
              className="absolute bg-slate-950/85"
              style={{
                left: `${region.x}%`,
                top: `${region.y}%`,
                width: `${region.width}%`,
                height: `${region.height}%`,
              }}
            />
          ))}
      </div>

      {face === "back" && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t("occlusionComposer.answerLabel")}:</span>
          <input
            data-testid="occlusion-preview-answer"
            value={explicitAnswer}
            onChange={(event) => setExplicitAnswer(event.target.value)}
            placeholder={label}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
      )}

      {total > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            aria-label={t("occlusionComposer.previousCard")}
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="rounded-full p-1 text-foreground hover:bg-muted disabled:opacity-30"
          >
            <CaretLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("occlusionComposer.nextCard")}
            disabled={index >= total - 1}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
            className="rounded-full p-1 text-foreground hover:bg-muted disabled:opacity-30"
          >
            <CaretRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
