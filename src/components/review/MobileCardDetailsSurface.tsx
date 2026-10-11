import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, DotsThreeVertical } from "@phosphor-icons/react";
import type { LearningItem } from "../../api/learning-items";
import { useI18n } from "../../lib/i18n";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";
import { CardContextMenu } from "./CardContextMenu";
import { CardPreviewPanel, type CardPreviewTab } from "./CardPreviewPanel";

interface MobileCardDetailsSurfaceProps {
  open: boolean;
  card: LearningItem | null;
  deckName?: string;
  onClose: () => void;
  onCardUpdate?: (updated: LearningItem) => void;
  onEditInStudio?: (card: LearningItem) => void;
  onSuspend: (cardId: string) => void;
  onUnsuspend: (cardId: string) => void;
  onDelete: (cardId: string) => void;
  onDuplicate: (card: LearningItem) => void;
  onMoveToDeck?: (cardId: string, deckId: string) => void;
  decks?: { id: string; name: string }[];
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function MobileCardDetailsSurface({
  open,
  card,
  deckName,
  onClose,
  onCardUpdate,
  onEditInStudio,
  onSuspend,
  onUnsuspend,
  onDelete,
  onDuplicate,
  onMoveToDeck,
  decks,
}: MobileCardDetailsSurfaceProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<CardPreviewTab>("preview");
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const lastCardIdRef = useRef(card?.id ?? null);

  useEffect(() => {
    if (card?.id === lastCardIdRef.current) return;
    lastCardIdRef.current = card?.id ?? null;
    setActiveTab("preview");
    setSecondaryOpen(false);
  }, [card?.id]);

  const dismiss = useCallback(() => {
    if (secondaryOpen) {
      setSecondaryOpen(false);
      return;
    }
    onClose();
  }, [onClose, secondaryOpen]);

  useOverlayDismissal(open && Boolean(card), dismiss, 90);

  useEffect(() => {
    if (!open || !card) {
      if (wasOpenRef.current) {
        const cardId = lastCardIdRef.current;
        if (cardId) {
          const row = Array.from(
            document.querySelectorAll<HTMLElement>("[data-deck-manager-card]")
          ).find((element) => element.dataset.deckManagerCard === cardId);
          row?.focus();
        }
        wasOpenRef.current = false;
      }
      return;
    }

    wasOpenRef.current = true;
    const focusTimer = window.setTimeout(() => backButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [card?.id, open]);

  useEffect(() => {
    if (!open || !card) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [card?.id, open]);

  if (!open || !card) return null;

  const question = plainText(card.question) || t("review.deckManager.title");
  const titleId = `mobile-card-details-title-${card.id}`;

  return createPortal(
    <div
      className="mobile-card-details-layer"
      data-testid="mobile-card-details"
      data-surface="opaque"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="mobile-card-details-header">
        <button
          ref={backButtonRef}
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center gap-1 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{t("common.back")}</span>
        </button>

        <div className="min-w-0 flex-1 px-2">
          {deckName && (
            <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {deckName}
            </div>
          )}
          <h2 id={titleId} className="truncate text-sm font-semibold text-foreground">
            {question}
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setSecondaryOpen(true)}
          className="inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("queue.moreOptions")}
          aria-haspopup="dialog"
          aria-expanded={secondaryOpen}
        >
          <DotsThreeVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <main className="mobile-card-details-body">
        <CardPreviewPanel
          card={card}
          onCardUpdate={onCardUpdate}
          onEditInStudio={onEditInStudio}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          mobile
        />
      </main>

      {secondaryOpen && (
        <CardContextMenu
          card={card}
          x={0}
          y={0}
          onClose={() => setSecondaryOpen(false)}
          onEditInStudio={onEditInStudio}
          onPreview={() => setActiveTab("preview")}
          onSuspend={onSuspend}
          onUnsuspend={onUnsuspend}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onMoveToDeck={onMoveToDeck}
          decks={decks}
        />
      )}
    </div>,
    document.body,
  );
}
