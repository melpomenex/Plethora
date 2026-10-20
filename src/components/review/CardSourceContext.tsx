import { useEffect, useId, useState } from "react";
import {
  CaretDown,
  CaretUp,
  BookOpen,
  ArrowSquareOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { getCardSourceContext, type CardSourceContext as SourceContextData } from "../../api/review";
import { getLearningItem } from "../../api/learning-items";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { openCardSource, sourceOutcomeKey, type CardSourceResolution } from "../../utils/cardSourceNavigation";

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
 * The whole title area is one bordered control that navigates to the exact
 * originating passage and returns the user to the same card afterwards. The
 * compact title is clamped to two lines; the source icon, page marker and
 * navigation cue stay visible independently of truncation.
 *
 * A separate disclosure below the title expands inline source details: the
 * complete wrapping title, the page marker, the stored excerpt and the
 * external source link. It never navigates, so touch users have an ordinary
 * way to read a title that was abbreviated. The link is a sibling of the
 * buttons, never nested inside one.
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
  const detailsId = useId();

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
  const hasSourceUrl = Boolean(context.source_url);
  const titleWithPage = context.page_number
    ? `${context.document_title} (p. ${context.page_number})`
    : context.document_title;

  return (
    <div
      data-card-source-context
      className="@container mt-3 mb-1 min-w-0 max-w-full rounded-lg border border-border/60 bg-muted/30"
    >
      <div className="flex min-w-0 flex-col">
        <button
          type="button"
          data-source-navigate
          onClick={() => (onActivate ? onActivate(itemId) : void handleActivate())}
          disabled={activating}
          title={titleWithPage}
          aria-label={`${t("review.viewSource")}: ${titleWithPage}`}
          className="flex w-full min-w-0 flex-wrap items-start gap-x-2 gap-y-1 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:opacity-50 min-h-10 [@media(pointer:coarse)]:min-h-12"
        >
          {/* The icon + text group wraps as a unit; its flex basis keeps the
              title beside the icon at normal sizes and lets the title take a
              full line (instead of collapsing to 0px) at 200% text. */}
          <span className="flex min-w-0 flex-[1_1_10rem] flex-wrap items-start gap-2">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <span className="flex min-w-0 flex-[1_1_6rem] flex-col">
              <span className="text-[11px] leading-4 text-muted-foreground">
                {t("review.sourceFrom")}
              </span>
              <span
                data-source-title-text
                className="line-clamp-2 min-w-0 italic text-foreground/80 [overflow-wrap:anywhere]"
              >
                {context.document_title}
              </span>
              {context.page_number ? (
                <span
                  data-source-page
                  className="mt-0.5 block tabular-nums text-[11px] leading-4 text-muted-foreground"
                >
                  {t("review.sourcePage", { page: context.page_number })}
                </span>
              ) : null}
            </span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 self-center">
            {activating ? (
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                aria-hidden="true"
              />
            ) : (
              <ArrowSquareOut className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden text-xs font-medium md:inline">{t("review.viewSource")}</span>
            <kbd className="hidden h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground md:inline-flex">
              V
            </kbd>
          </span>
        </button>

        <div className="flex min-w-0 border-t border-border/50 px-3 @max-[180px]:px-0">
          <button
            type="button"
            data-source-details
            onClick={() => setIsExpanded((value) => !value)}
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            className="inline-flex w-full min-h-10 min-w-10 items-center gap-1.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
          >
            {isExpanded ? (
              <CaretUp className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
            ) : (
              <CaretDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">
              {isExpanded ? t("review.sourceDetailsHide") : t("review.sourceDetails")}
            </span>
          </button>
        </div>

        <div
          id={detailsId}
          data-source-details-panel
          hidden={!isExpanded}
          className="min-w-0 border-t border-border/50 px-3 py-2 text-xs leading-relaxed text-foreground/70"
        >
          <p className="min-w-0 italic text-foreground/80 [overflow-wrap:anywhere]">
            {context.document_title}
          </p>
          {context.page_number ? (
            <p className="mt-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
              {t("review.sourcePage", { page: context.page_number })}
            </p>
          ) : null}
          {hasSnippet ? (
            <p className="mt-1 min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              {context.extract_snippet}
            </p>
          ) : null}
          {hasSourceUrl ? (
            <a
              data-source-link
              href={context.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex min-h-10 min-w-10 max-w-full items-center break-all text-[11px] underline opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 [overflow-wrap:anywhere] [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:min-w-12"
            >
              {t("review.sourceLink")}
            </a>
          ) : null}
        </div>

        {unavailable ? (
          <div
            className="flex min-w-0 items-start gap-2 border-t border-border/50 px-3 py-2 text-xs text-foreground/70 leading-relaxed"
            role="status"
          >
            <WarningCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {unavailable}
              {!isExpanded && context.extract_snippet && (
                <span className="mt-1 block italic text-muted-foreground">
                  {context.extract_snippet}
                </span>
              )}
            </span>
          </div>
        ) : null}
      </div>
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
  const key = sourceOutcomeKey(resolution);

  // `unavailable` is the only outcome with no navigation behind it, so it gets
  // the persistent panel beside the retained excerpt. Every other message is a
  // transient notice: the document did open.
  if (key && resolution.status === "unavailable") {
    setUnavailable(t(key));
    return;
  }

  setUnavailable(null);
  if (key) toast.info(t(key));
}
