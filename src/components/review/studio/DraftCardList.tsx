import React from "react";
import { Check, Copy, PencilSimple, Sparkle, Trash } from "@phosphor-icons/react";
import type { ImageAsset } from "../../../api/image-registry";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";
import { CardPreview } from "./DraftCardEditor";
import type { DraftCard } from "./types";

export interface DraftCardListProps {
  cards: DraftCard[];
  flippedCardId: string | null;
  onFlipCard: (id: string) => void;
  editingCardId: string | null;
  onStartEditCard: (id: string) => void;
  onSaveEditCard: (id: string, updates: Partial<DraftCard>) => void;
  onToggleSelectCard?: (id: string) => void;
  onDuplicateCard?: (card: DraftCard) => void;
  onDeleteCard?: (id: string) => void;
  sourceExcerpt?: string;
  imageAssets?: ImageAsset[];
  defaultImageAssetId?: string;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  renderCardActions?: (card: DraftCard) => React.ReactNode;
  emptyStateTitle?: string;
  emptyStateHint?: string;
  evidenceBadgeRenderer?: (card: DraftCard) => React.ReactNode;
}

export function DraftCardList({
  cards,
  flippedCardId,
  onFlipCard,
  editingCardId,
  onStartEditCard,
  onSaveEditCard,
  onToggleSelectCard,
  onDuplicateCard,
  onDeleteCard,
  sourceExcerpt,
  imageAssets = [],
  defaultImageAssetId,
  containerRef,
  renderCardActions,
  emptyStateTitle,
  emptyStateHint,
  evidenceBadgeRenderer,
}: DraftCardListProps) {
  const { t } = useI18n();

  if (cards.length === 0) {
    return (
      <div
        ref={containerRef as any}
        className="flex-1 min-h-0 flex flex-col items-center justify-center h-full text-center p-4"
      >
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
          <Sparkle className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          {emptyStateTitle || t("flashcardStudio.noDraftCards")}
        </p>
        <p className="text-xs text-muted-foreground">
          {emptyStateHint || t("flashcardStudio.generateCardsHint")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef as any}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
    >
      {cards.map((card, index) => (
        <div
          key={card.id}
          className={cn(
            "group relative rounded-xl border bg-card overflow-hidden transition-all duration-200",
            card.selected
              ? "border-primary/50 shadow-sm shadow-primary/10"
              : "border-border opacity-70 hover:opacity-100"
          )}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {/* Card Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            {onToggleSelectCard && (
              <button
                type="button"
                onClick={() => onToggleSelectCard(card.id)}
                className={cn(
                  "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                  card.selected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary/50"
                )}
              >
                {card.selected && <Check className="w-3.5 h-3.5" />}
              </button>
            )}
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
                card.type === "qa"
                  ? "bg-blue-500/10 text-blue-600"
                  : card.type === "cloze"
                  ? "bg-purple-500/10 text-purple-600"
                  : card.type === "multiple-choice"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-700"
              )}
            >
              {card.type === "qa"
                ? "Q&A"
                : card.type === "cloze"
                ? t("flashcardStudio.cardTypeCloze")
                : card.type === "multiple-choice"
                ? t("flashcardStudio.cardTypeMultipleChoice")
                : t("flashcardStudio.cardTypeImageOcclusion")}
            </span>

            {/* Custom Evidence / Provenance Badge */}
            {evidenceBadgeRenderer && evidenceBadgeRenderer(card)}

            {/* Tags */}
            {card.tags && card.tags.length > 0 && (
              <div className="flex items-center gap-1">
                {card.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
                {card.tags.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{card.tags.length - 2}
                  </span>
                )}
              </div>
            )}

            <div className="flex-1" />

            {/* Actions: either custom renderer or default duplicate/edit/delete buttons */}
            {renderCardActions ? (
              renderCardActions(card)
            ) : (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {onDuplicateCard && (
                  <button
                    type="button"
                    onClick={() => onDuplicateCard(card)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                    title={t("flashcardStudio.duplicate")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onStartEditCard(card.id)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                  title={t("flashcardStudio.edit")}
                >
                  <PencilSimple className="w-3.5 h-3.5" />
                </button>
                {onDeleteCard && (
                  <button
                    type="button"
                    onClick={() => onDeleteCard(card.id)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title={t("queue.delete")}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {card.saveError && <p role="alert" className="px-3 py-2 text-sm text-destructive">{card.saveError}</p>}
          {/* Card Content */}
          <CardPreview
            card={card}
            isFlipped={flippedCardId === card.id}
            onFlip={() => onFlipCard(card.id)}
            isEditing={editingCardId === card.id}
            onEdit={() => onStartEditCard(card.id)}
            onSaveEdit={(updates) => onSaveEditCard(card.id, updates)}
            sourceExcerpt={sourceExcerpt}
            imageAssets={imageAssets}
            defaultImageAssetId={defaultImageAssetId}
          />
        </div>
      ))}
    </div>
  );
}

export default DraftCardList;
