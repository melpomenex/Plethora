/**
 * Reading List Panel
 *
 * Surfaces saved Reading Lists in the RSS sidebar, above the Folders section.
 * Each row shows the list name, icon, and aggregated unread count, plus row
 * actions: Launch (scroll), Launch (list), Edit, Duplicate, Delete. Shows an
 * empty state when no lists exist yet.
 */

import { useMemo } from "react";
import {
  BookmarkSimple,
  Copy,
  ListChecks,
  PencilSimple,
  Scroll,
  Trash,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { Feed } from "../../../api/rss";
import type { ReadingList } from "../../../api/rss-reading-lists";

interface ReadingListPanelProps {
  lists: ReadingList[];
  /** All subscribed feeds, for computing unread counts. */
  feeds: Feed[];
  /** Whether this panel is the active article source (launch-into-list). */
  activeListId?: string | null;
  onLaunchScroll: (list: ReadingList) => void;
  onLaunchList: (list: ReadingList) => void;
  onEdit: (list: ReadingList) => void;
  onDuplicate: (list: ReadingList) => void;
  onDelete: (list: ReadingList) => void;
}

export function ReadingListPanel({
  lists,
  feeds,
  activeListId,
  onLaunchScroll,
  onLaunchList,
  onEdit,
  onDuplicate,
  onDelete,
}: ReadingListPanelProps) {
  const { t } = useI18n();

  // Unread count per list, aggregated client-side from loaded feeds. Stale
  // feed ids in a list are silently ignored (only currently-subscribed feeds
  // contribute).
  const unreadByList = useMemo(() => {
    const feedUnread = new Map<string, number>();
    feeds.forEach((f) => feedUnread.set(f.id, f.unreadCount ?? 0));
    const map = new Map<string, number>();
    lists.forEach((list) => {
      const total = list.feed_ids.reduce((acc, id) => acc + (feedUnread.get(id) ?? 0), 0);
      map.set(list.id, total);
    });
    return map;
  }, [lists, feeds]);

  return (
    <div className="border-b border-border/70">
      <div className="px-3 py-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <BookmarkSimple className="w-3.5 h-3.5" />
        {t("rssReader.readingLists")}
      </div>

      {lists.length === 0 ? (
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-muted-foreground/80">
          {t("rssReader.readingListsEmpty")}
        </p>
      ) : (
        <div className="pb-1">
          {lists.map((list) => {
            const unread = unreadByList.get(list.id) ?? 0;
            const isActive = activeListId === list.id;
            return (
              <div
                key={list.id}
                className={`group flex items-center gap-1 px-3 py-1.5 transition-colors ${
                  isActive ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
              >
                <button
                  onClick={() => onLaunchList(list)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                  title={t("rssReader.launchList", { name: list.name })}
                >
                  <ListChecks className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">{list.name}</span>
                  {unread > 0 && (
                    <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                      {unread}
                    </span>
                  )}
                </button>
                {/* Row actions — appear on hover, always keyboard-focusable */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onLaunchScroll(list)}
                    className="p-1 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 rounded transition-colors"
                    title={t("rssReader.launchScroll", { name: list.name })}
                    aria-label={t("rssReader.launchScroll", { name: list.name })}
                  >
                    <Scroll className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onEdit(list)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    title={t("common.edit")}
                    aria-label={t("common.edit")}
                  >
                    <PencilSimple className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDuplicate(list)}
                    className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                    title={t("rssReader.duplicate")}
                    aria-label={t("rssReader.duplicate")}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(list)}
                    className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                    title={t("common.delete")}
                    aria-label={t("common.delete")}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
