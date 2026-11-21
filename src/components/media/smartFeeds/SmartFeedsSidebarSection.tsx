import { useState } from "react";
import { ArrowsClockwise, Check, PencilSimple, Plus, Sparkle, Trash, X } from "@phosphor-icons/react";
import type { SmartFeedProgress, SmartFeedWithStats } from "../../../api/rss-smart-feeds";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";

interface SmartFeedsSidebarSectionProps {
  smartFeeds: SmartFeedWithStats[];
  activeSmartFeedId?: string | null;
  progressByFeedId: Record<string, SmartFeedProgress>;
  onSelect: (feed: SmartFeedWithStats) => void;
  onCreate: () => void;
  onEdit: (feed: SmartFeedWithStats) => void;
  onRefresh: (feed: SmartFeedWithStats) => void;
  onDelete: (feed: SmartFeedWithStats) => void;
}

export function SmartFeedsSidebarSection({
  smartFeeds,
  activeSmartFeedId,
  progressByFeedId,
  onSelect,
  onCreate,
  onEdit,
  onRefresh,
  onDelete,
}: SmartFeedsSidebarSectionProps) {
  const { t } = useI18n();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div data-testid="smart-feeds-sidebar-section" className="border-b border-border/70">
      <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span className="flex items-center gap-2 min-w-0">
          <Sparkle className="w-3.5 h-3.5 text-primary shrink-0" weight="fill" aria-hidden="true" />
          <span className="truncate">{t("smartFeeds.sectionTitle")}</span>
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={t("smartFeeds.createAction")}
          aria-label={t("smartFeeds.createAction")}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {smartFeeds.length === 0 ? (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground/85">
            {t("smartFeeds.sidebarEmpty")}
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t("smartFeeds.createAction")}
          </button>
        </div>
      ) : (
        <ul className="pb-1">
          {smartFeeds.map((sf) => {
            const isActive = activeSmartFeedId === sf.id;
            const prog = progressByFeedId[sf.id];
            const isRunning = prog?.phase === "running";
            return (
              <li
                key={sf.id}
                className={cn(
                  "group flex items-center gap-1 px-3 py-1.5 transition-colors",
                  isActive ? "bg-primary/10" : "hover:bg-muted/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(sf)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                  aria-current={isActive ? "page" : undefined}
                  aria-label={
                    isRunning
                      ? `${sf.name} (${t("smartFeeds.evaluating")})`
                      : sf.matched_count > 0
                        ? `${sf.name} (${sf.unread_count > 0 ? sf.unread_count : sf.matched_count})`
                        : sf.name
                  }
                >
                  <Sparkle
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      sf.is_enabled ? "text-primary" : "text-muted-foreground/50",
                    )}
                    weight={isActive ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "text-sm truncate",
                      sf.is_enabled ? "text-foreground" : "text-muted-foreground line-through",
                    )}
                  >
                    {sf.name}
                  </span>
                  {isRunning ? (
                    <ArrowsClockwise
                      className="ml-auto w-3.5 h-3.5 text-primary animate-spin motion-reduce:animate-none shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    sf.matched_count > 0 && (
                      <span
                        className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0"
                        aria-hidden="true"
                      >
                        {sf.unread_count > 0 ? sf.unread_count : sf.matched_count}
                      </span>
                    )
                  )}
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onRefresh(sf)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    title={t("smartFeeds.reevaluate")}
                    aria-label={`${t("smartFeeds.reevaluate")} ${sf.name}`}
                  >
                    <ArrowsClockwise className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(sf)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    title={t("common.edit")}
                    aria-label={`${t("common.edit")} ${sf.name}`}
                  >
                    <PencilSimple className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  {confirmDeleteId === sf.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          onDelete(sf);
                        }}
                        className="p-1 text-destructive hover:bg-destructive/15 rounded transition-colors"
                        title={t("common.confirm")}
                        aria-label={`${t("common.confirm")} ${t("common.delete")} ${sf.name}`}
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                        title={t("common.cancel")}
                        aria-label={`${t("common.cancel")} ${t("common.delete")} ${sf.name}`}
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(sf.id)}
                      className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                      title={t("common.delete")}
                      aria-label={`${t("common.delete")} ${sf.name}`}
                    >
                      <Trash className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
