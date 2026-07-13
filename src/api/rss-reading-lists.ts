/**
 * RSS Reading Lists API
 *
 * Reading Lists are named, ordered selections of feed ids used to launch a
 * scoped reading session (Scroll Mode or combined article list). Unlike
 * folders (where a feed lives), a feed may belong to many reading lists — they
 * are queries/selections, not containers.
 *
 * Persists to the `rss_reading_lists` backend table via Tauri commands or the
 * HTTP backend, mirroring the rss-folders.ts pattern.
 */

import { invokeCommand, isTauri } from "../lib/tauri";

export interface ReadingList {
  id: string;
  name: string;
  /** JSON-encoded array of feed ids on the wire (snake_case). */
  feed_ids: string[];
  icon?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function getApiBaseUrl(): string {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? `${window.location.protocol}//${window.location.hostname}:8766`
    : `${window.location.protocol}//${window.location.hostname}`;
}

function shouldUseHttp(): boolean {
  if (isTauri()) return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export async function getReadingListsAuto(): Promise<ReadingList[]> {
  if (shouldUseHttp()) {
    const res = await fetch(`${getApiBaseUrl()}/api/rss/reading-lists`);
    if (!res.ok) throw new Error(`Failed to get reading lists: ${res.statusText}`);
    return res.json();
  }
  return invokeCommand<ReadingList[]>("get_rss_reading_lists", {});
}

export async function createReadingListAuto(params: {
  name: string;
  feedIds?: string[];
  icon?: string;
  sortOrder?: number;
}): Promise<ReadingList> {
  const { name, feedIds, icon, sortOrder } = params;
  if (shouldUseHttp()) {
    const res = await fetch(`${getApiBaseUrl()}/api/rss/reading-lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        feed_ids: feedIds ?? [],
        icon,
        sort_order: sortOrder,
      }),
    });
    if (!res.ok) throw new Error(`Failed to create reading list: ${res.statusText}`);
    return res.json();
  }
  return invokeCommand<ReadingList>("create_rss_reading_list", {
    name,
    feedIds,
    icon,
    sortOrder,
  });
}

export async function updateReadingListAuto(
  id: string,
  updates: {
    name?: string;
    feedIds?: string[];
    icon?: string | null;
    sortOrder?: number;
  }
): Promise<ReadingList> {
  if (shouldUseHttp()) {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.name = updates.name;
    if (updates.feedIds !== undefined) body.feed_ids = updates.feedIds;
    if (updates.icon !== undefined) body.icon = updates.icon;
    if (updates.sortOrder !== undefined) body.sort_order = updates.sortOrder;
    const res = await fetch(`${getApiBaseUrl()}/api/rss/reading-lists/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update reading list: ${res.statusText}`);
    return res.json();
  }
  // Tauri command args are camelCase; the Rust Option<Option<T>> pattern is
  // represented as { icon: null } to clear vs { icon: undefined } to leave as-is.
  const args: Record<string, unknown> = { id };
  if (updates.name !== undefined) args.name = updates.name;
  if (updates.feedIds !== undefined) args.feedIds = updates.feedIds;
  if (updates.icon !== undefined) args.icon = updates.icon;
  if (updates.sortOrder !== undefined) args.sortOrder = updates.sortOrder;
  return invokeCommand<ReadingList>("update_rss_reading_list", args);
}

export async function deleteReadingListAuto(id: string): Promise<void> {
  if (shouldUseHttp()) {
    const res = await fetch(`${getApiBaseUrl()}/api/rss/reading-lists/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`Failed to delete reading list: ${res.statusText}`);
    return;
  }
  return invokeCommand<void>("delete_rss_reading_list", { id });
}

export async function duplicateReadingListAuto(id: string): Promise<ReadingList> {
  if (shouldUseHttp()) {
    const res = await fetch(`${getApiBaseUrl()}/api/rss/reading-lists/${id}/duplicate`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`Failed to duplicate reading list: ${res.statusText}`);
    return res.json();
  }
  return invokeCommand<ReadingList>("duplicate_rss_reading_list", { id });
}
