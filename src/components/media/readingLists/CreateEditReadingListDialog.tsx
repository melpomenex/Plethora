/**
 * Create / Edit Reading List Dialog
 *
 * Used both to create a new Reading List and to edit an existing one. Accepts
 * an optional pre-fill ({ name, feedIds }) so the sidebar can open it with a
 * section's or selection's feeds already populated ("save current section as a
 * Reading List").
 *
 * The feed tree is a flat list of sections (folders/categories) with their
 * member feeds, plus an ungrouped bucket — mirroring the sidebar layout so the
 * user can quickly check/unchek feeds by group.
 */

import { useState, useEffect, useMemo } from "react";
import { BookmarkSimple, Folder, X } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { Feed } from "../../../api/rss";
import type { ReadingList } from "../../../api/rss-reading-lists";

interface Prefill {
  name: string;
  feedIds: string[];
}

interface CreateEditReadingListDialogProps {
  isOpen: boolean;
  /** When set, the dialog edits this list; otherwise it creates a new one. */
  editing?: ReadingList | null;
  /** Initial name + feed ids for a fresh "save as" flow. */
  prefill?: Prefill | null;
  /** All subscribed feeds, used to render the checkbox tree. */
  feeds: Feed[];
  /** Folder/category grouping, mirroring the sidebar: section.id → feed ids. */
  sections: Array<{ id: string; name: string; feeds: Feed[]; isFolder: boolean }>;
  onClose: () => void;
  onSave: (name: string, feedIds: string[]) => void;
}

export function CreateEditReadingListDialog({
  isOpen,
  editing,
  prefill,
  feeds,
  sections,
  onClose,
  onSave,
}: CreateEditReadingListDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setName(editing.name);
      setSelected(new Set(editing.feed_ids));
    } else if (prefill) {
      setName(prefill.name);
      setSelected(new Set(prefill.feedIds));
    } else {
      setName("");
      setSelected(new Set());
    }
  }, [isOpen, editing, prefill]);

  const grouped = useMemo(() => {
    // Feeds that appear in some section.
    const assigned = new Set<string>();
    sections.forEach((s) => s.feeds.forEach((f) => assigned.add(f.id)));
    const ungrouped = feeds.filter((f) => !assigned.has(f.id));
    return { sections, ungrouped };
  }, [feeds, sections]);

  const toggleFeed = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSection = (feedIds: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = feedIds.every((id) => next.has(id));
      if (allIn) feedIds.forEach((id) => next.delete(id));
      else feedIds.forEach((id) => next.add(id));
      return next;
    });
  };

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0;

  const renderFeedCheckbox = (feed: Feed) => (
    <label
      key={feed.id}
      className="flex items-center gap-2 py-1 pl-8 cursor-pointer hover:bg-muted/50 rounded px-2"
    >
      <input
        type="checkbox"
        checked={selected.has(feed.id)}
        onChange={() => toggleFeed(feed.id)}
        className="h-3.5 w-3.5 accent-primary"
      />
      <span className="text-sm text-foreground truncate">{feed.title}</span>
    </label>
  );

  const renderSectionHeader = (
    sectionId: string,
    sectionName: string,
    feedIds: string[]
  ) => {
    const allIn = feedIds.length > 0 && feedIds.every((id) => selected.has(id));
    const someIn = feedIds.some((id) => selected.has(id));
    return (
      <label
        key={sectionId}
        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-muted/50 rounded px-2"
      >
        <input
          type="checkbox"
          checked={allIn}
          ref={(el) => {
            if (el) el.indeterminate = someIn && !allIn;
          }}
          onChange={() => toggleSection(feedIds)}
          className="h-3.5 w-3.5 accent-primary"
        />
        <Folder className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {sectionName}
        </span>
      </label>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center gap-2">
            <BookmarkSimple className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">
              {editing ? t("rssReader.editReadingList") : t("rssReader.newReadingList")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {t("rssReader.readingListName")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("rssReader.readingListNamePlaceholder")}
              autoFocus
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                {t("rssReader.chooseFeeds")}
              </label>
              <span className="text-xs text-muted-foreground">
                {t("rssReader.selectedCount", { count: selected.size })}
              </span>
            </div>
            <div className="rounded-md border border-border bg-background/50 max-h-72 overflow-y-auto py-1">
              {grouped.sections.map((section) => (
                <div key={section.id}>
                  {renderSectionHeader(section.id, section.name, section.feeds.map((f) => f.id))}
                  {section.feeds.map(renderFeedCheckbox)}
                </div>
              ))}
              {grouped.ungrouped.length > 0 && (
                <div>
                  {renderSectionHeader(
                    "ungrouped",
                    t("rssReader.ungrouped"),
                    grouped.ungrouped.map((f) => f.id)
                  )}
                  {grouped.ungrouped.map(renderFeedCheckbox)}
                </div>
              )}
              {feeds.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {t("rssReader.noFeedsToSelect")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => canSave && onSave(trimmedName, Array.from(selected))}
            disabled={!canSave}
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editing ? t("common.save") : t("rssReader.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
