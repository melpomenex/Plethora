/**
 * Quick Review Widget
 * Compact widget for quick reviews on dashboard or mobile home
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowCounterClockwise,
  ArrowsOutSimple,
  ArrowSquareOut,
  Brain,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  Clock,
  Copy,
  Flame,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  Target,
  X,
} from "@phosphor-icons/react";
import { useTTS } from "../../hooks/useTTS";
import { useI18n } from "../../lib/i18n";
import { useSurfaceMenu } from "../../hooks/useSurfaceMenu";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";
import { useToast } from "../common/Toast";
import type { LearningItem } from "../../api/review";
import { evaluateClozeCard, isClozeCardType } from "../../utils/cloze";

export interface QuickReviewCard {
  id: string;
  front: string;
  back: string;
  documentId?: string;
  documentTitle?: string;
  difficulty?: "easy" | "medium" | "hard";
  interval?: number;
}

function stripHtmlTags(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .trim();
}

/**
 * Format a due LearningItem into a QuickReviewCard with masked/revealed cloze deletions.
 */
export function formatLearningItemForQuickReview(
  item: LearningItem,
  documents: Array<{ id: string; title: string }> = []
): QuickReviewCard {
  const isCloze =
    isClozeCardType(item) ||
    Boolean(item.cloze_text) ||
    /\{\{(?:c\d+::|[^}]+)\}\}|\[\[c\d+::/i.test(item.question || "");

  let front = "";
  let back = "";

  if (isCloze) {
    const evaluated = evaluateClozeCard(item);
    if (evaluated.status === "valid") {
      front = stripHtmlTags(
        evaluated.segments
          .map((seg) =>
            seg.type === "deletion"
              ? seg.hint
                ? `[... (${seg.hint})]`
                : "[...]"
              : seg.text
          )
          .join("")
      );
      const revealedSentence = stripHtmlTags(
        evaluated.segments
          .map((seg) => (seg.type === "deletion" ? seg.answer : seg.text))
          .join("")
      );
      const extraAnswer = stripHtmlTags(item.answer);
      const deletionAnswers = evaluated.deletions.map((d) => stripHtmlTags(d.answer));
      back =
        extraAnswer &&
        extraAnswer.toLowerCase() !== "cloze deletion" &&
        !deletionAnswers.includes(extraAnswer) &&
        extraAnswer !== revealedSentence
          ? `${revealedSentence}\n\n${extraAnswer}`
          : revealedSentence;
    } else {
      const rawSource = item.cloze_text || item.question || "";
      front =
        stripHtmlTags(
          rawSource.replace(
            /\{\{(?:c\d+::)?([^}:]+)(?:::([^}]+))?\}\}|\[\[c\d+::([^:\]]+)(?:::([^\]]+))?\]\]/gi,
            (_m, _a1, h1, _a2, h2) => (h1 || h2 ? `[... (${h1 || h2})]` : "[...]")
          )
        ) || "Cloze Card";
      back =
        stripHtmlTags(
          rawSource.replace(
            /\{\{(?:c\d+::)?([^}:]+)(?:::[^}]+)?\}\}|\[\[c\d+::([^:\]]+)(?:::[^\]]+)?\]\]/gi,
            (_m, a1, a2) => a1 || a2 || ""
          )
        ) ||
        stripHtmlTags(item.answer) ||
        front;
    }
  } else {
    front = stripHtmlTags(item.question) || "Untitled card";
    back = stripHtmlTags(item.answer) || "";
  }

  const matchedDoc = item.document_id
    ? documents.find((d) => d.id === item.document_id)
    : undefined;

  let fallbackDocTitle: string | undefined;
  if (!matchedDoc?.title && item.source_reference) {
    try {
      const parsed = JSON.parse(item.source_reference);
      fallbackDocTitle = parsed?.documentTitle || parsed?.document_title;
    } catch {
      // ignore invalid JSON
    }
  }

  return {
    id: item.id,
    front,
    back,
    documentId: item.document_id,
    documentTitle: matchedDoc?.title || fallbackDocTitle,
    difficulty:
      item.difficulty >= 7 ? "hard" : item.difficulty >= 4 ? "medium" : "easy",
    interval: item.interval,
  };
}

interface QuickReviewWidgetProps {
  cards: QuickReviewCard[];
  onRate: (cardId: string, rating: "again" | "hard" | "good" | "easy") => Promise<void>;
  onExpand?: () => void;
  onOpenDocument?: (documentId: string) => void;
  maxCards?: number;
  autoPlay?: boolean;
  className?: string;
}

type Rating = "again" | "hard" | "good" | "easy";

const RATING_CONFIG: Record<Rating, { label: string; color: string; bgColor: string; icon: typeof Check }> = {
  again: { label: "again", color: "text-red-500", bgColor: "bg-red-500/20 hover:bg-red-500/30", icon: ArrowCounterClockwise },
  hard: { label: "hard", color: "text-amber-500", bgColor: "bg-amber-500/20 hover:bg-amber-500/30", icon: X },
  good: { label: "good", color: "text-green-500", bgColor: "bg-green-500/20 hover:bg-green-500/30", icon: Check },
  easy: { label: "easy", color: "text-blue-500", bgColor: "bg-blue-500/20 hover:bg-blue-500/30", icon: Sparkle },
};

export function QuickReviewWidget({
  cards,
  onRate,
  onExpand,
  onOpenDocument,
  maxCards = 10,
  autoPlay = false,
  className = "",
}: QuickReviewWidgetProps) {
  const { t } = useI18n();
  const toast = useToast();
  const quickReviewMenu = useSurfaceMenu("quick-review-widget-menu");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const { isSpeaking, speak, stop } = useTTS();

  // Limit cards to maxCards
  const reviewCards = useMemo(() => cards.slice(0, maxCards), [cards, maxCards]);
  const currentCard = reviewCards[currentIndex];
  const remainingCount = reviewCards.length - currentIndex;
  const progress = reviewCards.length > 0 ? (completedCount / reviewCards.length) * 100 : 0;

  // Auto-play TTS when card changes
  useEffect(() => {
    if (autoPlay && currentCard && !isFlipped) {
      speak(currentCard.front);
    }
    return () => stop();
  }, [currentCard, autoPlay, isFlipped, speak, stop]);

  const handleFlip = useCallback(() => {
    setIsFlipped(true);
    if (autoPlay && currentCard) {
      speak(currentCard.back);
    }
  }, [autoPlay, currentCard, speak]);

  const handleRate = useCallback(async (rating: Rating) => {
    if (!currentCard || isProcessing) return;

    setIsProcessing(true);
    try {
      await onRate(currentCard.id, rating);
      setCompletedCount((prev) => prev + 1);
      setCurrentIndex((prev) => prev + 1);
      setIsFlipped(false);
    } finally {
      setIsProcessing(false);
    }
  }, [currentCard, isProcessing, onRate]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setIsFlipped(false);
    }
  }, [currentIndex]);

  const copyText = (text: string, errorLabel: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("contextMenu.copiedToClipboard")),
      () => toast.error(errorLabel),
    );
  };

  const buildMenuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (currentCard && currentIndex < reviewCards.length && remainingCount > 0) {
      if (!isFlipped) {
        items.push({
          id: "flip-card",
          label: t("contextMenu.flipCard"),
          icon: <Brain className="w-4 h-4 text-primary" />,
          onClick: handleFlip,
        });
      }
      items.push({
        id: "read-aloud",
        label: isSpeaking ? t("common.stop") : t("quickReview.readAloud"),
        icon: isSpeaking
          ? <SpeakerSlash className="w-4 h-4 text-primary" />
          : <SpeakerHigh className="w-4 h-4 text-muted-foreground" />,
        onClick: () => (isSpeaking ? stop() : speak(isFlipped ? currentCard.back : currentCard.front)),
      });
      if (currentIndex > 0) {
        items.push({
          id: "previous-card",
          label: t("quickReview.previousCard"),
          icon: <CaretLeft className="w-4 h-4 text-muted-foreground" />,
          onClick: handlePrevious,
        });
      }
      if (currentCard.documentId && onOpenDocument) {
        items.push({
          id: "open-source-document",
          label: "Open source document",
          icon: <ArrowSquareOut className="w-4 h-4 text-muted-foreground" />,
          onClick: () => onOpenDocument(currentCard.documentId!),
        });
      }
      items.push(
        { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
        {
          id: "copy-front",
          label: t("contextMenu.copyFront"),
          icon: <Copy className="w-4 h-4 text-muted-foreground" />,
          onClick: () => copyText(currentCard.front, t("contextMenu.copyFront")),
        },
        {
          id: "copy-back",
          label: t("contextMenu.copyBack"),
          icon: <Copy className="w-4 h-4 text-muted-foreground" />,
          onClick: () => copyText(currentCard.back, t("contextMenu.copyBack")),
        },
      );
    }
    if (onExpand) {
      if (items.length > 0) {
        items.push({ id: "sep:2", type: ContextMenuItemType.Separator, label: "" });
      }
      items.push({
        id: "open-full-review",
        label: t("quickReview.openFullReview"),
        icon: <ArrowsOutSimple className="w-4 h-4 text-muted-foreground" />,
        onClick: onExpand,
      });
    }
    return items;
  };

  const handleWidgetContextMenu = (e: React.MouseEvent) => {
    const items = buildMenuItems();
    if (items.length > 0) {
      quickReviewMenu.openEvent(e, items);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when user is typing
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const target = e.target as HTMLElement;
      if (target.isContentEditable) {
        return;
      }

      if (!currentCard) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!isFlipped) handleFlip();
      }

      if (isFlipped) {
        switch (e.key) {
          case "1":
            handleRate("again");
            break;
          case "2":
            handleRate("hard");
            break;
          case "3":
            handleRate("good");
            break;
          case "4":
            handleRate("easy");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentCard, isFlipped, handleFlip, handleRate]);

  const quickReviewMenuEl = (
    <ContextMenu
      menuId="quick-review-widget-menu"
      items={quickReviewMenu.items}
      visible={quickReviewMenu.visible}
      position={quickReviewMenu.position}
      onClose={quickReviewMenu.closeToTrigger}
    />
  );

  if (reviewCards.length === 0) {
    return (
      <div
        onContextMenu={handleWidgetContextMenu}
        className={`bg-card border border-border rounded-2xl p-6 ${className}`}
      >
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="p-4 bg-green-500/10 rounded-full mb-4">
            <Check className="w-8 h-8 text-green-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{t("quickReview.allCaughtUp")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("quickReview.noCardsDue")}
          </p>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors"
            >
              <ArrowsOutSimple className="w-3.5 h-3.5" />
              <span>{t("quickReview.openFullReview")}</span>
            </button>
          )}
        </div>
        {quickReviewMenuEl}
      </div>
    );
  }

  if (currentIndex >= reviewCards.length || remainingCount === 0) {
    return (
      <div
        onContextMenu={handleWidgetContextMenu}
        className={`bg-card border border-border rounded-2xl p-6 ${className}`}
      >
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="p-4 bg-primary/10 rounded-full mb-4">
            <Target className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("quickReview.sessionComplete")}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t("quickReview.reviewedCards", { count: completedCount })}
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{t("quickReview.keepItUp")}</span>
            </div>
            <div className="flex items-center gap-1">
              <Flame className="w-4 h-4 text-orange-500" />
              <span>{t("quickReview.plusReviews", { count: completedCount })}</span>
            </div>
          </div>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
            >
              <ArrowsOutSimple className="w-3.5 h-3.5" />
              <span>{t("quickReview.openFullReview")}</span>
            </button>
          )}
        </div>
        {quickReviewMenuEl}
      </div>
    );
  }

  return (
    <div
      onContextMenu={handleWidgetContextMenu}
      className={`bg-card border border-border rounded-2xl overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-primary/5 to-primary/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/20 rounded-xl">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("quickReview.title")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("quickReview.cardsRemaining", { count: remainingCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onExpand && (
            <button
              onClick={onExpand}
              className="p-2 hover:bg-muted rounded-lg transition-colors"
              title={t("quickReview.openFullReview")}
            >
              <ArrowsOutSimple className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => isSpeaking ? stop() : speak(isFlipped ? currentCard.back : currentCard.front)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title={isSpeaking ? t("common.stop") : t("quickReview.readAloud")}
          >
            {isSpeaking ? (
              <SpeakerSlash className="w-4 h-4 text-primary" />
            ) : (
              <SpeakerHigh className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Card */}
      <div className="p-4">
        <div
          onClick={() => !isFlipped && handleFlip()}
          data-testid="quick-review-card-surface"
          className={`min-h-[120px] p-4 rounded-xl border transition-all cursor-pointer ${
            isFlipped
              ? "bg-primary/5 border-primary/20"
              : "bg-gradient-to-br from-card to-muted/50 border-border hover:border-primary/30"
          }`}
        >
          {/* Document source */}
          {(currentCard.documentTitle || (currentCard.documentId && onOpenDocument)) && (
            <div className="flex items-center justify-between gap-2 mb-2">
              {currentCard.documentTitle ? (
                <p className="text-xs text-muted-foreground truncate">
                  {currentCard.documentTitle}
                </p>
              ) : (
                <span />
              )}
              {currentCard.documentId && onOpenDocument && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDocument(currentCard.documentId!);
                  }}
                  title="Open source document"
                  aria-label={
                    currentCard.documentTitle
                      ? `Open source document: ${currentCard.documentTitle}`
                      : "Open source document"
                  }
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline flex-shrink-0"
                >
                  <span>View source</span>
                  <ArrowSquareOut className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Content */}
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {isFlipped ? currentCard.back : currentCard.front}
          </p>

          {/* Flip hint */}
          {!isFlipped && (
            <p className="text-xs text-muted-foreground mt-3 text-center">
              {t("quickReview.tapToReveal")}
            </p>
          )}
        </div>
      </div>

      {/* Rating buttons */}
      {isFlipped && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-4 gap-2">
            {(Object.entries(RATING_CONFIG) as [Rating, typeof RATING_CONFIG[Rating]][]).map(
              ([rating, config]) => {
                const Icon = config.icon;
                return (
                  <button
                    key={rating}
                    onClick={() => handleRate(rating)}
                    disabled={isProcessing}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${config.bgColor} disabled:opacity-50`}
                  >
                    {isProcessing ? (
                      <CircleNotch className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className={`w-4 h-4 ${config.color}`} />
                    )}
                    <span className={`text-xs font-medium ${config.color}`}>
                      {t(`review.${config.label}`)}
                    </span>
                  </button>
                );
              }
            )}
          </div>

          {/* Keyboard hints */}
          <div className="flex justify-center gap-4 mt-3">
            {(Object.entries(RATING_CONFIG) as [Rating, typeof RATING_CONFIG[Rating]][]).map(
              ([rating, config], index) => (
                <span key={rating} className="text-xs text-muted-foreground">
                  <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">{index + 1}</kbd>
                  {" "}{t(`review.${config.label}`)}
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      {!isFlipped && currentIndex > 0 && (
        <div className="px-4 pb-4">
          <button
            onClick={handlePrevious}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CaretLeft className="w-4 h-4" />
            {t("quickReview.previousCard")}
          </button>
        </div>
      )}
      {quickReviewMenuEl}
    </div>
  );
}

/**
 * Minimal inline quick review for dashboards
 */
interface InlineQuickReviewProps {
  dueCount: number;
  onStartReview: () => void;
  className?: string;
}

export function InlineQuickReview({
  dueCount,
  onStartReview,
  className = "",
}: InlineQuickReviewProps) {
  const { t } = useI18n();
  if (dueCount === 0) {
    return (
      <div
        className={`flex items-center gap-3 p-3 bg-green-500/10 rounded-xl ${className}`}
      >
        <div className="p-2 bg-green-500/20 rounded-lg">
          <Check className="w-4 h-4 text-green-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t("quickReview.allCaughtUp")}</p>
          <p className="text-xs text-muted-foreground">{t("quickReview.noReviewsDue")}</p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onStartReview}
      className={`w-full flex items-center gap-3 p-3 bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors ${className}`}
    >
      <div className="p-2 bg-primary/20 rounded-lg">
        <Brain className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 text-left">
        <p className="text-sm font-medium text-foreground">
          {t("quickReview.cardsDue", { count: dueCount })}
        </p>
        <p className="text-xs text-muted-foreground">{t("quickReview.startQuickReview")}</p>
      </div>
      <CaretRight className="w-4 h-4 text-muted-foreground" />
    </button>
  );
}

/**
 * Floating quick review button for mobile
 */
interface FloatingReviewButtonProps {
  dueCount: number;
  onClick: () => void;
  className?: string;
}

export function FloatingReviewButton({
  dueCount,
  onClick,
  className = "",
}: FloatingReviewButtonProps) {
  const { t } = useI18n();
  if (dueCount === 0) return null;

  return (
    <button
      onClick={onClick}
      className={`fixed bottom-20 right-4 flex items-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all hover:scale-105 active:scale-95 z-40 ${className}`}
    >
      <Brain className="w-5 h-5" />
      <span className="font-medium">{t("review.title")}</span>
      <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-white/20 rounded-full text-xs font-bold">
        {dueCount}
      </span>
    </button>
  );
}

/**
 * Stats row for quick review widget
 */
interface QuickReviewStatsProps {
  reviewed: number;
  correct: number;
  streak: number;
  className?: string;
}

export function QuickReviewStats({
  reviewed,
  correct,
  streak,
  className = "",
}: QuickReviewStatsProps) {
  const { t } = useI18n();
  const accuracy = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0;

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{t("quickReview.reviewedShort", { count: reviewed })}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Check className="w-3.5 h-3.5 text-green-500" />
        <span className="text-xs text-muted-foreground">{t("quickReview.accuracyShort", { count: accuracy })}</span>
      </div>
      {streak > 0 && (
        <div className="flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5 text-orange-500" />
          <span className="text-xs text-muted-foreground">{t("quickReview.streakShort", { count: streak })}</span>
        </div>
      )}
    </div>
  );
}

export default QuickReviewWidget;
