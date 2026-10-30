import React, { useEffect, useMemo, useState } from "react";
import { getImageAssetById } from "../../api/image-registry";
import { renderAnkiHtmlWithLatex, warmAnkiLatexNormalization } from "../../utils/ankiLatex";
import {
  type ClozeCardInput,
  evaluateClozeCard,
  isClozeCardType,
  hasRawClozeSyntax,
  renderClozeSegmentsHtml,
} from "../../utils/cloze";
import {
  computeVisibleOcclusionOverlays,
  evaluateCardOcclusion,
  isOcclusionCard,
} from "../../utils/occlusion";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";
import { Eye, WarningCircle } from "@phosphor-icons/react";

export interface ReviewCardContentProps {
  card: ClozeCardInput & { id: string; question: string; answer?: string; cloze_text?: string };
  showAnswer: boolean;
  part?: "question" | "answer" | "both";
  revealAllSiblings?: boolean;
  onToggleRevealAllSiblings?: () => void;
  className?: string;
  variant?: "review" | "scroll";
}

const assetUrlCache = new Map<string, string>();

type AssetState = "idle" | "loading" | "ready" | "error";

export const ReviewCardContent = React.memo(function ReviewCardContent({
  card,
  showAnswer,
  part = "both",
  revealAllSiblings = false,
  onToggleRevealAllSiblings,
  className,
  variant = "review",
}: ReviewCardContentProps) {
  const { t } = useI18n();

  // Warm LaTeX normalization cache
  useEffect(() => {
    warmAnkiLatexNormalization([card.question, card.answer, card.cloze_text]);
  }, [card.question, card.answer, card.cloze_text]);

  // Asset resolution with stale-load guards and instant synchronous cache
  const cardAssetIds: string[] = useMemo(() => {
    const raw = (card as any).image_asset_ids ?? (card as any).imageAssetIds;
    if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string" && Boolean(id));
    return [];
  }, [card]);

  const cachedUrls = useMemo(() => {
    if (cardAssetIds.length === 0) return [];
    const allCached = cardAssetIds.every((id) => assetUrlCache.has(id));
    if (allCached) {
      return cardAssetIds.map((id) => assetUrlCache.get(id)!);
    }
    return null;
  }, [cardAssetIds]);

  const [assetUrls, setAssetUrls] = useState<string[]>(() => cachedUrls ?? []);
  const [assetState, setAssetState] = useState<AssetState>(() => {
    if (cardAssetIds.length === 0) return "idle";
    return cachedUrls ? "ready" : "loading";
  });

  useEffect(() => {
    let isCancelled = false;
    if (cardAssetIds.length === 0) {
      setAssetUrls([]);
      setAssetState("idle");
      return;
    }

    if (cachedUrls) {
      setAssetUrls(cachedUrls);
      setAssetState("ready");
      return;
    }

    setAssetState("loading");
    const loadAssets = async () => {
      try {
        const assets = await Promise.all(cardAssetIds.map((id) => getImageAssetById(id)));
        if (isCancelled) return;
        const urls: string[] = [];
        for (let i = 0; i < cardAssetIds.length; i++) {
          const a = assets[i];
          const url = (a as any)?.data_url ?? (a as any)?.dataUrl;
          if (typeof url === "string" && Boolean(url)) {
            assetUrlCache.set(cardAssetIds[i], url);
            urls.push(url);
          }
        }

        if (urls.length === 0 && cardAssetIds.length > 0) {
          setAssetState("error");
        } else {
          setAssetUrls(urls);
          setAssetState("ready");
        }
      } catch {
        if (!isCancelled) setAssetState("error");
      }
    };

    void loadAssets();
    return () => {
      isCancelled = true;
    };
  }, [card.id, cardAssetIds, cachedUrls]);

  const isOcclusion = useMemo(() => isOcclusionCard(card), [card]);
  const occlusionEval = useMemo(() => {
    if (!isOcclusion) return null;
    return evaluateCardOcclusion(card);
  }, [isOcclusion, card]);

  const isCloze = useMemo(() => {
    return isClozeCardType(card) || Boolean(card.cloze_text) || hasRawClozeSyntax(card.question || "");
  }, [card]);

  const clozeEval = useMemo(() => {
    if (!isCloze) return null;
    return evaluateClozeCard(card);
  }, [isCloze, card]);

  // ==========================================
  // PART: ANSWER ONLY
  // ==========================================
  if (part === "answer") {
    if (!showAnswer) return null;

    // Cloze cards show their answers inline on the question prompt unless there is distinct answer text
    if (isCloze && clozeEval && clozeEval.status === "valid") {
      const distinctAnswer =
        card.answer && !clozeEval.sourceText.includes(card.answer) ? card.answer : null;
      if (!distinctAnswer) return null;
      return (
        <div
          data-testid="card-answer-content"
          className={cn(
            variant === "scroll"
              ? "text-xl leading-relaxed text-green-400"
              : "text-base md:text-lg leading-relaxed text-foreground",
            className
          )}
          dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(distinctAnswer) }}
        />
      );
    }

    // Occlusion card answer
    if (isOcclusion && occlusionEval && occlusionEval.kind === "valid") {
      const targetLabel = occlusionEval.targetRegion?.label;
      const explicitAnswer = card.answer?.trim();
      const answerToDisplay = explicitAnswer || targetLabel;
      if (!answerToDisplay) return null;
      return (
        <div
          data-testid="card-answer-content"
          className={cn(
            variant === "scroll"
              ? "text-xl leading-relaxed text-green-400"
              : "text-base md:text-lg leading-relaxed text-foreground",
            className
          )}
          dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(answerToDisplay) }}
        />
      );
    }

    // Basic / QA card answer
    if (!card.answer) return null;
    return (
      <div
        data-testid="card-answer-content"
        className={cn(
          variant === "scroll"
            ? "text-xl leading-relaxed text-green-400"
            : "text-base md:text-lg leading-relaxed text-foreground",
          className
        )}
        dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.answer) }}
      />
    );
  }

  // ==========================================
  // PART: QUESTION ONLY OR BOTH
  // ==========================================

  // 1. Image Occlusion
  if (isOcclusion && occlusionEval) {
    if (occlusionEval.kind === "invalid_geometry") {
      return (
        <div data-testid="occlusion-repair-state" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive font-medium">
          <div className="flex items-center gap-2 mb-1">
            <WarningCircle className="w-5 h-5 shrink-0" />
            <span>{t("review.invalidOcclusionGeometry") || "Invalid occlusion geometry"}</span>
          </div>
          <p className="text-xs opacity-90">{occlusionEval.message}</p>
        </div>
      );
    }

    if (occlusionEval.kind === "valid") {
      const activeAssetIndex = Math.max(
        0,
        assetUrls.findIndex((_, index) => {
          return occlusionEval.assetId ? cardAssetIds[index] === occlusionEval.assetId : index === 0;
        })
      );
      const imageUrl = assetUrls[activeAssetIndex];

      const visibleOverlays = computeVisibleOcclusionOverlays(
        occlusionEval,
        showAnswer,
        revealAllSiblings
      );

      return (
        <div className={cn("space-y-4", className)}>
          {occlusionEval.prompt && (
            <div className="text-sm md:text-base text-muted-foreground">
              <span dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(occlusionEval.prompt) }} />
            </div>
          )}

          {assetState === "loading" && (
            <div data-testid="occlusion-loading" className="flex items-center justify-center p-8 text-sm text-muted-foreground animate-pulse">
              {t("common.loading") || "Loading image asset..."}
            </div>
          )}

          {assetState === "error" && (
            <div data-testid="occlusion-missing-asset" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <p>{t("review.imageLoadFailed") || "Image asset unavailable or corrupted."}</p>
            </div>
          )}

          {assetState === "ready" && imageUrl && (
            <div className="flex justify-center">
              <div
                data-testid="occlusion-image-frame"
                className="relative w-fit overflow-hidden rounded-2xl border border-border bg-muted/20"
              >
                <img
                  src={imageUrl}
                  alt={t("review.imageOcclusionAlt") || "Image occlusion study prompt"}
                  className="block h-auto w-auto max-h-[40dvh] max-w-full md:max-h-[calc(100dvh-32rem)]"
                />
                {visibleOverlays.map((region) => {
                  const isTarget = region.id
                    ? region.id === occlusionEval.targetRegion.id
                    : region === occlusionEval.targetRegion;

                  return (
                    <div
                      key={region.id || `${region.x}-${region.y}-${region.width}-${region.height}`}
                      data-testid="occlusion-region-overlay"
                      data-occlusion-target={isTarget ? "true" : "false"}
                      className={cn(
                        "absolute flex items-center justify-center rounded-md bg-slate-950 shadow-sm transition-all",
                        isTarget
                          ? "border-2 border-primary ring-2 ring-primary/30 z-10"
                          : "border border-white/20 z-0"
                      )}
                      style={{
                        left: `${region.x}%`,
                        top: `${region.y}%`,
                        width: `${region.width}%`,
                        height: `${region.height}%`,
                        backgroundColor: region.color || "#0f172a",
                      }}
                    >
                      {isTarget && !showAnswer && (
                        <span
                          data-testid="occlusion-target-badge"
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-primary font-bold text-xs text-primary-foreground shadow"
                          aria-hidden="true"
                        >
                          ?
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {showAnswer && occlusionEval.hasSiblings && !occlusionEval.isHideOne && onToggleRevealAllSiblings && (
            <div className="flex justify-center">
              <button
                type="button"
                data-testid="occlusion-reveal-all"
                onClick={onToggleRevealAllSiblings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Eye className="w-4 h-4" />
                {revealAllSiblings ? (t("review.hideAllLabels") || "Hide other labels") : (t("review.revealAllLabels") || "Reveal all labels")}
              </button>
            </div>
          )}

          {part === "both" && showAnswer && card.answer && (
            <div
              data-testid="card-answer-content"
              className="mt-4 pt-4 border-t border-border/50 text-base md:text-lg leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.answer) }}
            />
          )}
        </div>
      );
    }
  }

  // 2. Cloze Card
  if (isCloze && clozeEval) {
    if (clozeEval.status === "repair_required") {
      return (
        <div data-testid="cloze-repair-state" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-foreground">
          <div className="flex items-center gap-2 mb-1 text-amber-600 dark:text-amber-400 font-semibold">
            <WarningCircle className="w-5 h-5 shrink-0" />
            <span>{t("review.clozeRepairRequired") || "Card requires repair"}</span>
          </div>
          <p className="text-xs text-muted-foreground">{clozeEval.message}</p>
        </div>
      );
    }

    const html = renderClozeSegmentsHtml(clozeEval, showAnswer);
    const textClass =
      variant === "scroll"
        ? "text-xl md:text-2xl leading-relaxed text-foreground"
        : "text-base md:text-lg leading-relaxed text-foreground";

    return (
      <div className={cn("space-y-4", className)}>
        <div
          data-testid="cloze-content"
          className={textClass}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Render attached non-occlusion images if any */}
        {assetState === "ready" && assetUrls.length > 0 && !isOcclusion && (
          <div className="flex flex-wrap gap-3 justify-center">
            {assetUrls.map((url, idx) => (
              <img
                key={idx}
                src={url}
                alt={`Flashcard visual ${idx + 1}`}
                className="rounded-xl max-h-72 object-contain border border-border"
              />
            ))}
          </div>
        )}

        {part === "both" && showAnswer && card.answer && !clozeEval.sourceText.includes(card.answer) && (
          <div
            data-testid="card-answer-content"
            className="mt-4 pt-4 border-t border-border/50 text-base md:text-lg leading-relaxed text-foreground"
            dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.answer) }}
          />
        )}
      </div>
    );
  }

  // 3. Basic / QA / Flashcard
  const basicTextClass =
    variant === "scroll"
      ? "text-xl md:text-2xl leading-relaxed text-foreground"
      : "text-base md:text-lg leading-relaxed text-foreground";

  return (
    <div className={cn("space-y-4", className)}>
      <div
        data-testid="card-question-content"
        className={basicTextClass}
        dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.question || "") }}
      />

      {/* Render attached non-occlusion images */}
      {assetState === "ready" && assetUrls.length > 0 && !isOcclusion && (
        <div className="flex flex-wrap gap-3 justify-center">
          {assetUrls.map((url, idx) => (
            <img
              key={idx}
              src={url}
              alt={`Flashcard visual ${idx + 1}`}
              className="rounded-xl max-h-72 object-contain border border-border"
            />
          ))}
        </div>
      )}

      {part === "both" && showAnswer && card.answer && (
        <div
          data-testid="card-answer-content"
          className="mt-4 pt-4 border-t border-border/50 text-base md:text-lg leading-relaxed text-foreground"
          dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(card.answer) }}
        />
      )}
    </div>
  );
});
