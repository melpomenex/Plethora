import { ArrowsClockwise, PencilSimple, Plus, Sparkle, X } from "@phosphor-icons/react";
import { formatFeedDate } from "../../../api/rss";
import type { SmartFeedProgress, SmartFeedWithStats } from "../../../api/rss-smart-feeds";
import { useI18n } from "../../../lib/i18n";

export interface SmartFeedsDashboardSectionProps {
  smartFeeds: SmartFeedWithStats[];
  progressByFeedId: Record<string, SmartFeedProgress>;
  onSelect: (feed: SmartFeedWithStats) => void;
  onCreate: () => void;
  onEdit: (feed: SmartFeedWithStats) => void;
  onRefresh: (feed: SmartFeedWithStats) => void;
  onCancel?: (feed: SmartFeedWithStats) => void;
}

export function SmartFeedsDashboardSection({
  smartFeeds,
  progressByFeedId,
  onSelect,
  onCreate,
  onEdit,
  onRefresh,
  onCancel,
}: SmartFeedsDashboardSectionProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4" data-testid="smart-feeds-dashboard-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
            <Sparkle className="w-4 h-4 text-primary" weight="fill" aria-hidden="true" />
            {t("smartFeeds.sectionTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("smartFeeds.dashboardSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          {t("smartFeeds.createAction")}
        </button>
      </div>

      {smartFeeds.length === 0 ? (
        <div className="p-5 bg-card border border-border/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {t("smartFeeds.dashboardEmptyTitle")}
            </p>
            <p className="text-xs text-muted-foreground max-w-xl">
              {t("smartFeeds.dashboardEmptyDesc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/60 hover:bg-muted text-foreground text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t("smartFeeds.createButton")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {smartFeeds.map((sf) => {
            const prog = progressByFeedId[sf.id];
            const isRunning = prog?.phase === "running";
            const total = Math.max(1, prog?.total ?? 1);
            const evaluated = Math.min(total, prog?.evaluated ?? 0);

            return (
              <div
                key={sf.id}
                className="p-4 bg-card border border-border/80 rounded-2xl flex flex-col gap-3 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(sf)}
                    className="text-left min-w-0 flex-1 group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkle
                        className={`w-4 h-4 shrink-0 ${
                          sf.is_enabled ? "text-primary" : "text-muted-foreground"
                        }`}
                        weight="fill"
                        aria-hidden="true"
                      />
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary truncate transition-colors">
                        {sf.name}
                      </span>
                      {!sf.is_enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {t("smartFeeds.pausedBadge")}
                        </span>
                      )}
                      {sf.lexical_only_count > 0 && !isRunning && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0">
                          {t("smartFeeds.lexicalModeBadge")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {sf.description}
                    </p>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {isRunning && onCancel ? (
                      <button
                        type="button"
                        onClick={() => onCancel(sf)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={t("common.cancel")}
                        aria-label={`${t("common.cancel")} ${sf.name}`}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRefresh(sf)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("smartFeeds.reevaluate")}
                        aria-label={`${t("smartFeeds.reevaluate")} ${sf.name}`}
                      >
                        <ArrowsClockwise className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onEdit(sf)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={t("common.edit")}
                      aria-label={`${t("common.edit")} ${sf.name}`}
                    >
                      <PencilSimple className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {isRunning && prog && (
                  <div className="space-y-1">
                    <progress
                      value={evaluated}
                      max={total}
                      aria-label={t("smartFeeds.evaluatingProgress", { name: sf.name })}
                      className="w-full h-1.5 rounded overflow-hidden accent-primary"
                    />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {t("smartFeeds.progressSummary", {
                          evaluated: prog.evaluated,
                          total: prog.total,
                        })}
                      </span>
                      {prog.matched > 0 && (
                        <span>
                          {t("smartFeeds.matchedCountBadge", { count: prog.matched })}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {t("smartFeeds.matchedCountBadge", { count: sf.matched_count })}
                    </span>
                    {sf.unread_count > 0 && (
                      <span className="text-primary font-medium">
                        · {t("smartFeeds.unreadCountBadge", { count: sf.unread_count })}
                      </span>
                    )}
                    {sf.uncertain_count > 0 && (
                      <span>
                        · {t("smartFeeds.uncertainCountBadge", { count: sf.uncertain_count })}
                      </span>
                    )}
                  </div>
                  <span>
                    {t("smartFeeds.sourceFeedsCount", { count: sf.source_feed_count })}
                    {sf.last_evaluated_at ? ` · ${formatFeedDate(sf.last_evaluated_at)}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
