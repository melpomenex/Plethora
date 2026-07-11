/**
 * Cross-device replication for the assistant side-panel conversations.
 *
 * The side AssistantPanel (src/components/assistant/AssistantPanel.tsx) keeps a
 * per-context conversation history keyed by `document:<id>` / `web:<url>` /
 * `video:<id>` / `general` in localStorage under
 * `assistant-panel-conversations-v1`. That key is deliberately in the
 * `BLOCKED_KEYS` of localStorageSync.ts (conversations can contain image
 * data-URLs that would bloat the shared Yjs doc), so without this entity a
 * chat beside an item on one device never reaches the others.
 *
 * Approach mirrors documents/extracts: a row-LWW ReplicatedMap keyed by the
 * conversation key, where the row payload is the conversation. Crucially,
 * `strip` drops the `images` field from every message before publishing — the
 * same discipline documentReplication applies to `coverImageUrl`. Image
 * attachments are device-local (the receiver sees the message text; the
 * original image lives only on the device that produced it). Text content,
 * tool calls, role and timestamp all sync.
 *
 * Storage stays in localStorage; this entity's `apply` writes the merged
 * conversation back through the *original* `localStorage.setItem` (bypassing
 * the localStorageSync broadcast, which would otherwise echo it), then emits
 * `incrementum:synced-conversation` so the open AssistantPanel reloads.
 */

import { createReplicatedMap, type ReplicatedMap } from "../replicatedMap";
import { isTauri } from "../../tauri";
import { nowHLC } from "../syncClock";
import type { SectionSourceReference } from "../../../utils/sectionIndex";

/** localStorage key the AssistantPanel reads/writes. Must match exactly. */
export const ASSISTANT_CONVERSATIONS_KEY = "assistant-panel-conversations-v1";
/** Cap mirrored from AssistantPanel.MAX_STORED_MESSAGES. */
const MAX_STORED_MESSAGES = 200;

export interface SyncedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: Array<{
    name: string;
    parameters: Record<string, unknown>;
    result?: unknown;
    status: "pending" | "success" | "error";
  }>;
  sourceContext?: SectionSourceReference;
  /** Images are STRIPPED before publishing (see module doc). Kept on the type
   * because getLocal reads them from localStorage where they still exist. */
  images?: Array<{ id: string; dataUrl: string; fileName?: string; fileSize?: number }>;
}

export interface SyncedConversation {
  /** Conversation key: `document:<id>` | `web:<url>` | `video:<id>` | `general`. */
  key: string;
  messages: SyncedMessage[];
  /** Draft text in the input box (so a half-typed prompt resumes on the other
   * device). May be empty. */
  input: string;
  /** HLC string used as the row-LWW clock. Set by the publisher. */
  updatedAt: string;
}

let conversationsMap: ReplicatedMap<SyncedConversation> | null = null;

/** Read the conversations blob from localStorage as a plain record. */
function readStoredMap(): Record<string, { messages: unknown[]; input: string; updatedAt: number }> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, { messages: unknown[]; input: string; updatedAt: number }>;
  } catch {
    return {};
  }
}

/** Write the conversations blob via the *original* localStorage.setItem so we
 *  don't trigger localStorageSync's broadcast (which would create an echo). */
function writeStoredMap(map: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    // localStorageSync monkeypatches localStorage.setItem; reach under it to
    // the native setter so this write isn't re-broadcast (the row already came
    // from the shared doc; rebroadcasting would just add a tombstone).
    const nativeSet = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")?.value;
    if (nativeSet) {
      nativeSet.call(window.localStorage, ASSISTANT_CONVERSATIONS_KEY, JSON.stringify(map));
    } else {
      window.localStorage.setItem(ASSISTANT_CONVERSATIONS_KEY, JSON.stringify(map));
    }
  } catch (err) {
    console.warn("[sync:conversations] failed to write conversation to localStorage", err);
  }
}

function coerceMessage(raw: unknown): SyncedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string") return null;
  const role = m.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return null;
  if (typeof m.content !== "string") return null;
  if (typeof m.timestamp !== "number") return null;
  const out: SyncedMessage = { id: m.id, role, content: m.content, timestamp: m.timestamp };
  if (Array.isArray(m.toolCalls)) out.toolCalls = m.toolCalls as SyncedMessage["toolCalls"];
  if (m.sourceContext && typeof m.sourceContext === "object") {
    const source = m.sourceContext as Partial<SectionSourceReference>;
    if (Array.isArray(source.sectionIds) && Array.isArray(source.labels) && Array.isArray(source.ranges)) {
      out.sourceContext = source as SectionSourceReference;
    }
  }
  if (Array.isArray(m.images)) out.images = m.images as SyncedMessage["images"];
  return out;
}

/** Normalize a raw localStorage conversation row into the wire shape. */
export function toSyncedConversation(
  key: string,
  raw: { messages: unknown[]; input?: string; updatedAt?: number },
): SyncedConversation {
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map(coerceMessage)
    .filter((m): m is SyncedMessage => m !== null)
    .slice(-MAX_STORED_MESSAGES);
  return {
    key,
    messages,
    input: typeof raw.input === "string" ? raw.input : "",
    // Use the stored epoch-ms updatedAt when present; fall back to the latest
    // message timestamp; finally nowHLC() so a fresh row always has a clock.
    updatedAt: raw.updatedAt
      ? `${String(raw.updatedAt).padStart(13, "0")}.000000`
      : messages.length > 0
        ? `${String(messages[messages.length - 1].timestamp).padStart(13, "0")}.000000`
        : nowHLC(),
  };
}

/**
 * Strip `images` from every message before publishing. Image data-URLs are
 * multi-MB and would bloat the shared Yjs doc (the same reason coverImageUrl is
 * stripped from synced documents). The message text + tool calls remain.
 */
function stripImages(row: SyncedConversation): Partial<SyncedConversation> {
  return {
    key: row.key,
    input: row.input,
    updatedAt: row.updatedAt,
    messages: row.messages.map((m) => ({ ...m, images: undefined })),
  };
}

function getConversationsMap(): ReplicatedMap<SyncedConversation> {
  if (!conversationsMap) {
    conversationsMap = createReplicatedMap<SyncedConversation>({
      name: "assistantConversations",
      label: "conversations",
      mode: "row-lww",
      clockField: "updatedAt",
      strip: stripImages,
      getLocal: async (key) => {
        const stored = readStoredMap()[key];
        if (!stored) return null;
        return toSyncedConversation(key, stored);
      },
      apply: async (key, row) => {
        // Merge the remote conversation into localStorage. We overwrite the
        // single conversation entry (row-LWW already resolved which side is
        // newer); other conversation keys in the blob are preserved.
        const stored = readStoredMap();
        stored[key] = {
          messages: row.messages.slice(-MAX_STORED_MESSAGES),
          input: row.input,
          updatedAt: Number(row.updatedAt?.split(".")[0]) || Date.now(),
        };
        writeStoredMap(stored);
        try {
          window.dispatchEvent(
            new CustomEvent("incrementum:synced-conversation", { detail: { key } }),
          );
        } catch {
          /* ignore */
        }
      },
      applyDelete: async (key) => {
        const stored = readStoredMap();
        if (key in stored) {
          delete stored[key];
          writeStoredMap(stored);
        }
        try {
          window.dispatchEvent(
            new CustomEvent("incrementum:synced-conversation-deleted", { detail: { key } }),
          );
        } catch {
          /* ignore */
        }
      },
    });
  }
  return conversationsMap;
}

/**
 * Publish a conversation to the sync room. The caller (AssistantPanel) passes
 * the key + the raw localStorage row; we normalize, stamp a fresh clock, and
 * publish. Idempotent and safe to call on every change (the trailing debounce
 * in the panel keeps publish volume reasonable).
 */
export async function publishConversation(
  key: string,
  raw: { messages: unknown[]; input?: string },
): Promise<void> {
  if (!isTauri()) return;
  const now = Date.now();
  const synced = toSyncedConversation(key, { ...raw, updatedAt: now });
  // Write the published clock back to localStorage so the echo guard in
  // replicatedMap (handleRemote → getLocal) recognizes our own write: when the
  // provider echoes our publish back to us, local updatedAt will equal the
  // remote updatedAt and the row is skipped. Without this, the echo would
  // re-apply the stripped (imageless) remote copy and clobber local images.
  const stored = readStoredMap();
  stored[key] = {
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-MAX_STORED_MESSAGES) : [],
    input: typeof raw.input === "string" ? raw.input : "",
    updatedAt: now,
  };
  writeStoredMap(stored);
  await getConversationsMap().publish(key, synced);
}

/** Publish a tombstone for a cleared conversation. */
export async function publishConversationDeleted(key: string): Promise<void> {
  if (!isTauri()) return;
  await getConversationsMap().delete(key);
}

/** Boot the replication observer. Called once from startSyncSubsystems. */
export async function ensureConversationSyncReady(): Promise<void> {
  if (!isTauri()) return;
  await getConversationsMap().ensureReady();
}
