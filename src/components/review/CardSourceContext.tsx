import { useEffect, useState } from "react";
import { CaretDown, CaretRight, BookOpen, ArrowSquareOut, WarningCircle } from "@phosphor-icons/react";
import { getCardSourceContext, type CardSourceContext as SourceContextData } from "../../api/review";
import { getLearningItem } from "../../api/learning-items";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { openCardSource, type CardSourceResolution } from "../../utils/cardSourceNavigation";

interface CardSourceContextProps {
  itemId: string;
  /**
   * Override the default navigation behavior (open the source document at the
   * originating passage). When omitted the component navigates itself.
   */
  onActivate?: (itemId: string) => void;
}

/**
 * Source-context strip rendered on review cards — the primary "view source"
 * affordance.
 *
 * Left segment: the "From: <document>" disclosure (expandable extract snippet),
 * as shipped by add-review-source-context. Right segment: the view-source
 * action that navigates to the exact originating passage and returns the user
 * to the same card afterwards.
 *
 * Hidden entirely when the user disabled source context or the card has no
 * resolvable source — a source-less card never shows a dead affordance.
 * Resolution runs on activation only; nothing expensive happens at render.
 */
export function CardSourceContext({ itemId, onActivate }: CardSourceContextProps) {
  const [context, setContext] = useState<SourceContextData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activating, setActivating] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const settings = useSettingsStore((state) => state.settings);
  const enabled =
    (settings as any)?.learning?.showSourceContext ?? true;
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setLoaded(false);
    setIsExpanded(false);
    setUnavailable(null);

    if (!enabled) {
      setLoaded(true);
      return;
    }

    getCardSourceContext(itemId)
      .then((result) => {
        if (!cancelled) {
          setContext(result);
        }
      })
      .catch(() => {
        // Source resolution is best-effort; never block review on it.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [itemId, enabled]);

  if (!enabled || !loaded || !context) {
    return null;
  }

  const handleActivate = async () => {
    if (activating) return;
    setActivating(true);
    try {
      const item = await getLearningItem(itemId);
      if (!item) {
        setUnavailable(t("review.source.unavailable"));
        return;
      }
      const resolution = await openCardSource(item, useTabsStore.getState().addTab, {
        reviewReturn: true,
      });
      presentResolution(resolution, { setUnavailable, toast, t });
    } catch {
      toast.error(t("review.source.unavailable"));
    } finally {
      setActivating(false);
    }
  };

  const hasSnippet = Boolean(context.extract_snippet);
  const titleWithPage = context.page_number
    ? `${context.document_title} (p. ${context.page_number})`
    : context.document_title;

  return (
    <div className="mt-3 mb-1 rounded-lg border border-border/60 bg-muted/30">
      <div className="flex w-full items-stretch">
        <button
          type="button"
          onClick={() => hasSnippet && setIsExpanded((v) => !v)}
          className={`flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground ${
            hasSnippet ? "hover:bg-muted/60 cursor-pointer" : "cursor-default"
          } transition-colors min-h-[36px]`}
          aria-expanded={isExpanded}
        >
          <BookOpen className="h-3.5 w-3.5 flex-shrink-0 opacity-70" aria-hidden="true" />
          {hasSnippet ? (
            isExpanded ? (
              <CaretDown className="h-3 w-3 flex-shrink-0 opacity-70" aria-hidden="true" />
            ) : (
              <CaretRight className="h-3 w-3 flex-shrink-0 opacity-70" aria-hidden="true" />
            )
          ) : (
            <span className="w-3" />
          )}
          <span className="truncate">
            {t("review.sourceFrom")}{" "}
            <span className="italic text-foreground/80">{titleWithPage}</span>
          </span>
          {context.source_url && (
            <a
              href={context.source_url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0 text-[10px] underline opacity-70 hover:opacity-100"
            >
              {t("review.sourceLink")}
            </a>
          )}
        </button>
        <button
          type="button"
          onClick={() => (onActivate ? onActivate(itemId) : void handleActivate())}
          disabled={activating}
          title={t("review.viewSource")}
          aria-label={`${t("review.viewSource")}: ${context.document_title}`}
          className="flex flex-shrink-0 items-center gap-1.5 border-l border-border/50 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 min-h-[44px] md:min-h-0"
        >
          {activating ? (
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            <ArrowSquareOut className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="hidden md:inline">{t("review.viewSource")}</span>
          <kbd className="hidden md:inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
            V
          </kbd>
        </button>
      </div>
      {unavailable ? (
        <div
          className="flex items-start gap-2 border-t border-border/50 px-3 py-2 text-xs text-foreground/70 leading-relaxed"
          role="status"
        >
          <WarningCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 opacity-70" aria-hidden="true" />
          <span>
            {unavailable}
            {context.extract_snippet && (
              <span className="mt-1 block italic text-muted-foreground">
                {context.extract_snippet}
              </span>
            )}
          </span>
        </div>
      ) : (
        isExpanded &&
        hasSnippet && (
          <div className="border-t border-border/50 px-3 py-2 text-xs text-foreground/70 leading-relaxed">
            {context.extract_snippet}
          </div>
        )
      )}
    </div>
  );
}

/** Shared presentation of degraded navigation outcomes (strip, menu, Zen). */
export function presentResolution(
  resolution: CardSourceResolution,
  ui: {
    setUnavailable: (message: string | null) => void;
    toast: ReturnType<typeof useToast>;
    t: (key: string) => string;
  }
): void {
  const { setUnavailable, toast, t } = ui;
  switch (resolution.status) {
    case "ready":
      setUnavailable(null);
      break;
    case "coarse":
      if (resolution.reason === "ambiguous") {
        toast.info(t("review.source.ambiguous"));
      } else {
        toast.info(t("review.source.notLocated"));
      }
      setUnavailable(null);
      break;
    case "unavailable":
      setUnavailable(t("review.source.unavailable"));
      break;
  }
}
