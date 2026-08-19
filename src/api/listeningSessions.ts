/**
 * Listening Sessions API
 * 
 * Manages hands-free study listening sessions, captured extract markers,
 * bookmarks, and deferred session inbox items.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  ListeningSession,
  ListeningSessionItem,
} from "../types/audioEdition";

const browserSessionStore = new Map<string, ListeningSession>();
const browserSessionItemsStore = new Map<string, ListeningSessionItem[]>();

/** The Rust side stores is_reviewed as an INTEGER; normalize on every read. */
function normalizeSession(raw: any): ListeningSession {
  return { ...raw, isReviewed: Boolean(raw?.isReviewed) };
}

function normalizeSessionWithItems(raw: any): ListeningSession {
  return { ...normalizeSession(raw), items: raw?.items ?? [] };
}

export async function createListeningSession(
  session: Partial<ListeningSession> & { editionId: string }
): Promise<ListeningSession> {
  const newSession: ListeningSession = {
    id: session.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`),
    editionId: session.editionId,
    startedAt: session.startedAt || Date.now(),
    endedAt: session.endedAt || null,
    durationSeconds: session.durationSeconds || 0,
    extractCount: session.extractCount || 0,
    isReviewed: session.isReviewed || false,
    items: [],
  };

  if (!isTauri()) {
    browserSessionStore.set(newSession.id, newSession);
    browserSessionItemsStore.set(newSession.id, []);
    return newSession;
  }

  return normalizeSession(
    await invokeCommand<any>("create_listening_session", {
      session: {
        ...newSession,
        isReviewed: newSession.isReviewed ? 1 : 0,
      },
    })
  );
}

export async function getListeningSession(id: string): Promise<ListeningSession | null> {
  if (!isTauri()) {
    const s = browserSessionStore.get(id);
    if (!s) return null;
    return { ...s, items: browserSessionItemsStore.get(id) || [] };
  }

  const result = await invokeCommand<any>("get_listening_session", { id });
  if (!result) return null;
  return normalizeSessionWithItems(result);
}

export async function getActiveListeningSession(editionId: string): Promise<ListeningSession | null> {
  if (!isTauri()) {
    for (const s of browserSessionStore.values()) {
      if (s.editionId === editionId && !s.endedAt) {
        return { ...s, items: browserSessionItemsStore.get(s.id) || [] };
      }
    }
    return null;
  }

  const result = await invokeCommand<any>("get_active_listening_session", { editionId });
  if (!result) return null;
  return normalizeSessionWithItems(result);
}

export async function endListeningSession(
  id: string,
  endedAt: number = Date.now(),
  durationSeconds: number = 0,
  extractCount: number = 0
): Promise<void> {
  if (!isTauri()) {
    const s = browserSessionStore.get(id);
    if (s) {
      s.endedAt = endedAt;
      s.durationSeconds = durationSeconds;
      s.extractCount = extractCount;
    }
    return;
  }

  await invokeCommand<void>("end_listening_session", {
    id,
    endedAt,
    durationSeconds,
    extractCount,
  });
}

export async function markListeningSessionReviewed(
  id: string,
  isReviewed: boolean
): Promise<void> {
  if (!isTauri()) {
    const s = browserSessionStore.get(id);
    if (s) s.isReviewed = isReviewed;
    return;
  }

  await invokeCommand<void>("mark_listening_session_reviewed", {
    id,
    isReviewed,
  });
}

export async function listUnreviewedListeningSessions(): Promise<ListeningSession[]> {
  if (!isTauri()) {
    return Array.from(browserSessionStore.values())
      .filter(s => !s.isReviewed && s.extractCount > 0)
      .map(s => ({
        ...s,
        items: browserSessionItemsStore.get(s.id) || [],
      }));
  }

  const list = await invokeCommand<any[]>("list_unreviewed_listening_sessions");
  return (list || []).map(normalizeSessionWithItems);
}

export async function addListeningSessionItem(
  item: Omit<ListeningSessionItem, "id" | "createdAt"> & { id?: string; createdAt?: number }
): Promise<ListeningSessionItem> {
  const newItem: ListeningSessionItem = {
    id: item.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `item-${Date.now()}`),
    sessionId: item.sessionId,
    extractId: item.extractId || null,
    markerType: item.markerType,
    audioTimestamp: item.audioTimestamp,
    sourceAnchor: item.sourceAnchor,
    snippetText: item.snippetText,
    note: item.note || null,
    createdAt: item.createdAt || Date.now(),
  };

  if (!isTauri()) {
    const items = browserSessionItemsStore.get(item.sessionId) || [];
    items.push(newItem);
    browserSessionItemsStore.set(item.sessionId, items);

    // Mirror the backend rule: only actual extracts bump extract_count.
    const s = browserSessionStore.get(item.sessionId);
    if (s && newItem.markerType === "extract") s.extractCount += 1;
    return newItem;
  }

  return await invokeCommand<ListeningSessionItem>("add_listening_session_item", {
    item: newItem,
  });
}

export async function getListeningSessionItems(sessionId: string): Promise<ListeningSessionItem[]> {
  if (!isTauri()) {
    return browserSessionItemsStore.get(sessionId) || [];
  }

  return await invokeCommand<ListeningSessionItem[]>("get_listening_session_items", {
    sessionId,
  });
}

export async function deleteListeningSessionItem(id: string): Promise<void> {
  if (!isTauri()) {
    for (const [sessId, items] of browserSessionItemsStore.entries()) {
      const idx = items.findIndex(i => i.id === id);
      if (idx !== -1) {
        const removed = items[idx];
        items.splice(idx, 1);
        const s = browserSessionStore.get(sessId);
        if (s && removed.markerType === "extract" && s.extractCount > 0) s.extractCount -= 1;
        break;
      }
    }
    return;
  }

  await invokeCommand<void>("delete_listening_session_item", { id });
}

export async function listListeningSessions(unreviewedOnly = true): Promise<ListeningSession[]> {
  if (unreviewedOnly) {
    return listUnreviewedListeningSessions();
  }
  if (!isTauri()) {
    return Array.from(browserSessionStore.values()).map(s => ({
      ...s,
      items: browserSessionItemsStore.get(s.id) || [],
    }));
  }
  const list = await invokeCommand<any[]>("list_listening_sessions", {
    unreviewedOnly: false,
  });
  return (list || []).map(normalizeSessionWithItems);
}

export async function updateListeningSessionItem(
  id: string,
  updates: Partial<ListeningSessionItem>
): Promise<void> {
  if (!isTauri()) {
    for (const items of browserSessionItemsStore.values()) {
      const item = items.find((i) => i.id === id);
      if (item) {
        Object.assign(item, updates);
        break;
      }
    }
    return;
  }

  await invokeCommand<any>("update_listening_session_item", { id, updates });
}

