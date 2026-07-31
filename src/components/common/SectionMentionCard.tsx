import { useState, useId, type KeyboardEvent } from "react";
import { CaretDown, CaretRight, Hash, BookOpen, X } from "@phosphor-icons/react";
import type { SectionNode } from "../../utils/sectionIndex";
import { estimateTokens } from "../../utils/sectionIndex";
import { useI18n } from "../../lib/i18n";

interface SectionMentionCardProps {
  node: SectionNode;
  onRemove?: (id: string) => void;
  /** Defaults to false (collapsed). */
  defaultExpanded?: boolean;
}

function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

/**
 * Token-tier badge styling, kept consistent with the Assistant's existing
 * selected-section pill tiers (emerald < 1k, amber <= 4k, rose > 4k, muted 0).
 */
function getTokenBadgeClass(tokens: number): string {
  if (tokens === 0) {
    return "bg-muted text-muted-foreground border-border/30";
  }
  if (tokens < 1000) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
  }
  if (tokens <= 4000) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20";
  }
  return "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20";
}

/**
 * Collapsed-by-default card for a selected document section (chosen via `#`).
 *
 * - Collapsed: a single-line header (icon + title/breadcrumb + token badge +
 *   remove + expand chevron). Section body text is NOT rendered.
 * - Expanded: reveals the section's captured `content` in a bounded, scrollable
 *   region so the user can read exactly what will be fed to the model without a
 *   blob of text overflowing the chat input.
 *
 * Expansion is local UI state only — it never changes selection, token
 * estimates, or what is sent to the LLM.
 */
export function SectionMentionCard({
  node,
  onRemove,
  defaultExpanded = false,
}: SectionMentionCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);
  const bodyId = useId();

  const tokens = node.content ? estimateTokens(node.content) : 0;
  const label =
    node.breadcrumb.length > 0
      ? `${node.breadcrumb[node.breadcrumb.length - 1]} > ${node.title}`
      : node.title;
  const breadcrumbTitle =
    node.breadcrumb.length > 0 ? node.breadcrumb.join(" > ") : node.title;

  const handleToggleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setExpanded((prev) => !prev);
    }
  };

  const hasContent = node.content && node.content.trim().length > 0;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Header (collapsed summary) — single line */}
      <div className="flex items-center gap-1.5 px-2 py-1 min-h-[24px]">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          onKeyDown={handleToggleKey}
          aria-expanded={expanded}
          aria-controls={bodyId}
          title={expanded ? t("common.collapse") : t("common.expand")}
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left rounded-md px-1 py-0.5 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <CaretDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <CaretRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
          )}
          {node.level === 1 ? (
            <BookOpen className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
          ) : (
            <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0" title={breadcrumbTitle}>
            {label}
          </span>
        </button>

        <span
          className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${getTokenBadgeClass(tokens)}`}
          title={`${tokens.toLocaleString()} tokens`}
        >
          {tokens > 0 ? `${formatTokenCount(tokens)} tokens` : "-- tokens"}
        </span>

        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(node.id)}
            aria-label={t("common.remove")}
            title={t("common.remove")}
            className="rounded-md p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Expanded body — section content in a bounded, scrollable region */}
      {expanded && (
        <div
          id={bodyId}
          role="region"
          aria-label={t("sectionMention.contentPreview", { title: node.title })}
          className="border-t border-border bg-muted/30 px-2 py-1.5 max-h-48 overflow-y-auto"
        >
          {hasContent ? (
            <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground font-sans m-0">
              {node.content}
            </pre>
          ) : (
            <p className="text-[11px] italic text-muted-foreground m-0">
              {t("sectionMention.noPreview")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
