import type { CSSProperties } from "react";
import type { FeedItem } from "../api/rss";

export interface RssUserPreference {
  id: string;
  user_id?: string;
  feed_id?: string;
  keyword_include?: string | null;
  keyword_exclude?: string | null;
  author_whitelist?: string | null;
  author_blacklist?: string | null;
  category_filter?: string | null;
  view_mode?: string | null;
  theme_mode?: string | null;
  density?: string | null;
  column_count?: number | null;
  show_thumbnails?: boolean | null;
  excerpt_length?: number | null;
  show_author?: boolean | null;
  show_date?: boolean | null;
  show_feed_icon?: boolean | null;
  sort_by?: string | null;
  sort_order?: string | null;
  thumbnail_size?: string | null;
  card_height?: string | null;
  // Reader preferences
  font_family?: string | null;
  font_size?: number | null;
  line_height?: number | null;
  content_width?: number | null;
  text_align?: string | null;
  date_created: string;
  date_modified: string;
}

export interface RssUserPreferenceUpdate {
  keyword_include?: string | null;
  keyword_exclude?: string | null;
  author_whitelist?: string | null;
  author_blacklist?: string | null;
  category_filter?: string | null;
  view_mode?: string | null;
  theme_mode?: string | null;
  density?: string | null;
  column_count?: number | null;
  show_thumbnails?: boolean | null;
  excerpt_length?: number | null;
  show_author?: boolean | null;
  show_date?: boolean | null;
  show_feed_icon?: boolean | null;
  sort_by?: string | null;
  sort_order?: string | null;
  thumbnail_size?: string | null;
  card_height?: string | null;
  // Reader preferences
  font_family?: string | null;
  font_size?: number | null;
  line_height?: number | null;
  content_width?: number | null;
  text_align?: string | null;
}

export const RSS_FONTS = {
  serif:
    '"Iowan Old Style", "Charter", "Source Serif 4", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"Menlo", "Consolas", "Monaco", "Liberation Mono", "Lucida Console", monospace',
};
export const RSS_DEFAULTS: RssUserPreferenceUpdate = {
  keyword_include: "",
  keyword_exclude: "",
  author_whitelist: "",
  author_blacklist: "",
  category_filter: "",
  view_mode: "card",
  theme_mode: "system",
  density: "normal",
  column_count: 2,
  show_thumbnails: true,
  thumbnail_size: "small",
  card_height: "normal",
  excerpt_length: 150,
  show_author: true,
  show_date: true,
  show_feed_icon: true,
  sort_by: "date",
  sort_order: "desc",
  font_family: RSS_FONTS.serif,
  font_size: 16,
  line_height: 1.6,
  content_width: 65,
  text_align: "left",
};
const ENUMS: Record<string, string[]> = {
  view_mode: ["card", "list", "compact"],
  theme_mode: ["system", "light", "dark", "sepia", "slate", "oled"],
  density: ["compact", "normal", "comfortable"],
  thumbnail_size: ["small", "large"],
  card_height: ["compact", "normal", "tall"],
  sort_by: ["date", "title", "read_status", "reading_time"],
  sort_order: ["asc", "desc"],
  text_align: ["left", "justify"],
};
const RANGES: Record<string, [number, number]> = {
  font_size: [12, 32],
  line_height: [1, 2.5],
  content_width: [40, 100],
  column_count: [1, 6],
  excerpt_length: [50, 500],
};
export function normalizeRssPreferences(input: RssUserPreferenceUpdate): RssUserPreferenceUpdate {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(key in RSS_DEFAULTS) || value === undefined) continue;
    if (value === null) {
      result[key] = null;
      continue;
    }
    if (ENUMS[key]) {
      if (ENUMS[key].includes(value as string)) result[key] = value;
    } else if (RANGES[key]) {
      const [min, max] = RANGES[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        const bounded = Math.max(min, Math.min(max, value));
        result[key] = key === "line_height" ? bounded : Math.round(bounded);
      }
    } else if (key.startsWith("show_")) {
      if (typeof value === "boolean") result[key] = value;
    } else if (typeof value === "string") result[key] = value;
  }
  return result;
}
export function resolveRssPreferences(
  ...layers: RssUserPreferenceUpdate[]
): RssUserPreferenceUpdate {
  return Object.assign(
    {},
    RSS_DEFAULTS,
    ...layers.map((layer) =>
      Object.fromEntries(
        Object.entries(normalizeRssPreferences(layer)).filter(([, value]) => value !== null)
      )
    )
  );
}
export function rssReadingStyle(input?: RssUserPreferenceUpdate | null): CSSProperties {
  const p = resolveRssPreferences(input ?? {});
  const palette = (
    {
      light: ["#ffffff", "#0f172a", "#475569"],
      dark: ["#0f172a", "#f8fafc", "#94a3b8"],
      slate: ["#0f172a", "#f8fafc", "#94a3b8"],
      sepia: ["#fbf6ec", "#433422", "#65533f"],
      oled: ["#000000", "#e5e7eb", "#9ca3af"],
    } as Record<string, string[]>
  )[p.theme_mode ?? "system"];
  return {
    "--reading-font-family": p.font_family,
    "--reading-font-size": `${p.font_size}px`,
    "--reading-line-height": p.line_height,
    "--reading-text-align": p.text_align,
    "--reading-max-width": `${p.content_width}ch`,
    ...(palette
      ? {
          backgroundColor: palette[0],
          color: palette[1],
          "--color-background": palette[0],
          "--color-foreground": palette[1],
          "--color-muted-foreground": palette[2],
        }
      : {}),
  } as CSSProperties;
}
function articleText(item: FeedItem): string {
  return (item.fullContent || item.content || item.description || "").replace(/<[^>]*>/g, " ");
}
export function filterRssArticles<T extends { item: FeedItem }>(
  list: T[],
  p: RssUserPreferenceUpdate
): T[] {
  const terms = (value?: string | null) =>
    (value || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  const include = terms(p.keyword_include),
    exclude = terms(p.keyword_exclude);
  const allowed = terms(p.author_whitelist),
    blocked = terms(p.author_blacklist),
    categories = terms(p.category_filter);
  return list.filter(({ item }) => {
    const text = `${item.title} ${articleText(item)}`.toLowerCase(),
      author = (item.author || "").toLowerCase();
    return (
      (!include.length || include.some((x) => text.includes(x))) &&
      !exclude.some((x) => text.includes(x)) &&
      (!allowed.length || allowed.some((x) => author.includes(x))) &&
      !blocked.some((x) => author.includes(x)) &&
      (!categories.length ||
        categories.some((x) => (item.categories || []).some((c) => c.toLowerCase().includes(x))))
    );
  });
}
export function sortRssArticles<T extends { item: FeedItem }>(
  list: T[],
  p: RssUserPreferenceUpdate
): T[] {
  const date = (item: FeedItem) => Date.parse(item.pubDate) || 0;
  const cost = (item: FeedItem) => articleText(item).trim().split(/\s+/).filter(Boolean).length;
  const direction = p.sort_order === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let comparison: number;
    switch (p.sort_by) {
      case "title":
        comparison = a.item.title.localeCompare(b.item.title);
        break;
      case "read_status":
        comparison = Number(a.item.read) - Number(b.item.read);
        break;
      case "reading_time":
        comparison = cost(a.item) - cost(b.item);
        break;
      default:
        comparison = date(a.item) - date(b.item);
    }
    return (
      direction * comparison || date(b.item) - date(a.item) || a.item.id.localeCompare(b.item.id)
    );
  });
}
export const RSS_PRESETS: Record<string, RssUserPreferenceUpdate> = {
  compact: { view_mode: "compact", density: "compact" },
  reading: { view_mode: "list", density: "comfortable", card_height: "tall" },
  unread: { sort_by: "read_status", sort_order: "asc" },
};
