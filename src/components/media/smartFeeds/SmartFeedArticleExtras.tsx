import { useId, useState } from "react";
import { ArrowCounterClockwise, CaretDown, CaretUp, Check, Warning, X } from "@phosphor-icons/react";
import type {
  SmartFeedArticleItem,
  SmartFeedClusterMember,
  SmartFeedFeedbackType,
} from "../../../api/rss-smart-feeds";
import { useI18n } from "../../../lib/i18n";

export interface SmartFeedArticleExtrasProps {
  article: SmartFeedArticleItem;
  pendingFeedback?: SmartFeedFeedbackType | null;
  onFeedback: (type: SmartFeedFeedbackType) => void;
  onSelectSiblingSmartFeed: (smartFeedId: string) => void;
  onOpenClusterArticle: (member: SmartFeedClusterMember) => void;
  compact?: boolean;
}

export function SmartFeedArticleExtras({
  article,
  pendingFeedback,
  onFeedback,
  onSelectSiblingSmartFeed,
  onOpenClusterArticle,
  compact = false,
}: SmartFeedArticleExtrasProps) {
  const { t } = useI18n();
  const reasonId = useId();
  const clusterId = useId();
  const [whyOpen, setWhyOpen] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(false);

  const effectiveFeedback =
    pendingFeedback !== undefined ? pendingFeedback : (article.active_feedback ?? null);
  const scorePct = Math.round(article.relevance_score * 100);
  const isLexicalOnly = article.evaluation_status === "completed_lexical";
  const isDeferredOrError =
    article.evaluation_status === "deferred" || article.evaluation_status === "error";

  const whyLabel =
    article.decision === "EXCLUDE"
      ? t("smartFeeds.whyExcluded")
      : t("smartFeeds.whyIncluded");

  return (
    <div
      className={compact ? "space-y-1.5 text-xs" : "mt-2 pt-2 border-t border-border/50 space-y-2 text-xs"}
      data-smart-feed-extras={article.article_id}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          {t("smartFeeds.relevanceScore", { percent: scorePct })}
        </span>

        {article.matched_evidence.slice(0, compact ? 3 : 4).map((term) => (
          <span
            key={term}
            className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
          >
            {term}
          </span>
        ))}

        {isLexicalOnly && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
            {t("smartFeeds.lexicalModeBadge")}
          </span>
        )}

        {isDeferredOrError && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Warning className="w-3 h-3" aria-hidden="true" />
            {article.error_message || t("smartFeeds.providerDeferredNotice")}
          </span>
        )}

        {article.also_in_smart_feeds.map((badge) => (
          <button
            key={badge.smart_feed_id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectSiblingSmartFeed(badge.smart_feed_id);
            }}
            className="px-1.5 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors"
            title={t("smartFeeds.alsoInFeedTooltip", { name: badge.smart_feed_name })}
          >
            {badge.smart_feed_name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={whyOpen}
            aria-controls={reasonId}
            onClick={(e) => {
              e.stopPropagation();
              setWhyOpen((prev) => !prev);
            }}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {whyLabel}
            {whyOpen ? (
              <CaretUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <CaretDown className="w-3 h-3" aria-hidden="true" />
            )}
          </button>

          {article.cluster_size > 1 && article.cluster_members.length > 0 && (
            <button
              type="button"
              aria-expanded={clusterOpen}
              aria-controls={clusterId}
              onClick={(e) => {
                e.stopPropagation();
                setClusterOpen((prev) => !prev);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              {t("smartFeeds.sourcesCoveringStory", { count: article.cluster_size })}
              {clusterOpen ? (
                <CaretUp className="w-3 h-3" aria-hidden="true" />
              ) : (
                <CaretDown className="w-3 h-3" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {effectiveFeedback && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-foreground text-[11px]">
              {effectiveFeedback === "SHOULD_INCLUDE"
                ? t("smartFeeds.feedbackMarkedInclude")
                : t("smartFeeds.feedbackMarkedExclude")}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFeedback("UNDO");
                }}
                className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline font-medium"
              >
                <ArrowCounterClockwise className="w-3 h-3" aria-hidden="true" />
                {t("smartFeeds.undoFeedback")}
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFeedback("SHOULD_INCLUDE");
            }}
            aria-pressed={effectiveFeedback === "SHOULD_INCLUDE"}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
              effectiveFeedback === "SHOULD_INCLUDE"
                ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            {t("smartFeeds.belongsInFeed")}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFeedback("SHOULD_EXCLUDE");
            }}
            aria-pressed={effectiveFeedback === "SHOULD_EXCLUDE"}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
              effectiveFeedback === "SHOULD_EXCLUDE"
                ? "border-destructive/60 bg-destructive/15 text-destructive font-medium"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/70"
            }`}
          >
            <X className="w-3 h-3" aria-hidden="true" />
            {t("smartFeeds.doesNotBelong")}
          </button>
        </div>
      </div>

      {whyOpen && (
        <div
          id={reasonId}
          className="p-2.5 rounded-lg bg-muted/50 border border-border/60 text-[11px] space-y-1.5 text-muted-foreground"
        >
          <p className="text-foreground font-medium">{article.decision_reason}</p>
          <p>
            {t("smartFeeds.decisionMetadata", {
              source: article.decision_source,
              percent: scorePct,
            })}
          </p>
          {article.diagnostics && (
            <div className="space-y-1 pt-1 border-t border-border/40">
              {article.diagnostics.supporting_passages.length > 0 && (
                <div>
                  <span className="font-medium text-foreground">
                    {t("smartFeeds.supportingEvidenceLabel")}:{" "}
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 mt-0.5">
                    {article.diagnostics.supporting_passages.map((excerpt, i) => (
                      <li key={i}>{excerpt}</li>
                    ))}
                  </ul>
                </div>
              )}
              {article.diagnostics.contradictory_passages.length > 0 && (
                <div>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {t("smartFeeds.contradictoryEvidenceLabel")}:{" "}
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 mt-0.5">
                    {article.diagnostics.contradictory_passages.map((excerpt, i) => (
                      <li key={i}>{excerpt}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="pt-0.5">
                <summary className="cursor-pointer select-none text-[10px] font-medium hover:text-foreground">
                  {t("smartFeeds.technicalDiagnostics")}
                </summary>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                  <span>{t("smartFeeds.diagDepth")}: {article.diagnostics.evaluation_depth}</span>
                  <span>{t("smartFeeds.diagContent")}: {article.diagnostics.content_provenance}</span>
                  <span>
                    {t("smartFeeds.diagPassages")}: {article.diagnostics.passages_evaluated} / {article.diagnostics.passages_total}
                  </span>
                  <span>
                    {t("smartFeeds.diagTruncation")}:{" "}
                    {article.diagnostics.unexpected_truncation
                      ? `${article.diagnostics.state_tokens_dropped} tokens`
                      : t("smartFeeds.diagNone")}
                  </span>
                </div>
              </details>
            </div>
          )}
        </div>
      )}

      {clusterOpen && article.cluster_members.length > 0 && (
        <div
          id={clusterId}
          className="p-2.5 rounded-lg bg-muted/40 border border-border/60 space-y-1"
        >
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("smartFeeds.clusterRelatedArticles")}
          </p>
          <ul className="space-y-1">
            {article.cluster_members.map((member) => (
              <li key={member.article_id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenClusterArticle(member);
                  }}
                  className="text-left text-[11px] text-primary hover:underline flex items-baseline gap-1.5"
                >
                  <span className="font-medium text-muted-foreground shrink-0">
                    [{member.feed_title || member.similarity_kind}]
                  </span>
                  <span className="truncate">{member.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
