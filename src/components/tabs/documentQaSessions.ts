/**
 * Document Q&A sessions — client-side persistence of distinct Q&A
 * conversations. Each session groups the chat (`messages`), the selected
 * focus document, and the web-search toggle so the user can start a clean
 * conversation for a new document/topic without losing past conversations,
 * and resume a previous one later.
 *
 * Mirrors the model already shipped for AI Flashcard Studio
 * (`src/components/review/flashcardStudioSessions.ts`), adapted to Q&A's
 * simpler shape (no draft pile, no deck/provider/context-selection).
 *
 * Backed by `localStorage`. No backend/Rust involvement.
 *
 * Caps:
 * - at most `MAX_SESSIONS` sessions (oldest dropped by `updatedAt`)
 * - at most `MAX_MESSAGES_PER_SESSION` messages per session (matches today's
 *   effective LLM replay window of ~6 turns).
 */

import type { QAMessage } from "../../stores";

/** localStorage keys for the sessions model. */
export const STORAGE_KEYS = {
  sessions: "document-qa-sessions-v1",
  activeSession: "document-qa-active-session-v1",
  sidebarCollapsed: "document-qa-sidebar-collapsed-v1",
} as const;

/**
 * Legacy key retained read-only for one release as a migration source /
 * rollback net. This is the `useDocumentQAStore` Zustand `persist` key; its
 * persisted value is wrapped by zustand as `{ state: { messages }, version }`.
 */
export const LEGACY_STORAGE_KEYS = {
  state: "plethora-document-qa",
} as const;

export const MAX_SESSIONS = 50;
export const MAX_MESSAGES_PER_SESSION = 50;

export const PLACEHOLDER_TITLE = "New chat";
export const PLACEHOLDER_DOCUMENT_NAME = "Whole Library";
const TITLE_MAX_CHARS = 60;

export interface DocumentQaSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** "" means Whole Library (RAG). */
  selectedDocumentId: string;
  webSearchEnabled: boolean;
  messages: QAMessage[];
  /** Denormalized count derived from `messages.length`. */
  messageCount: number;
  /** Denormalized focus-document name for the sessions list. */
  documentName?: string;
}

/**
 * Shape persisted by `zustand/middleware/persist` for `useDocumentQAStore`.
 * The middleware wraps the partialized state as `{ state, version }`. We also
 * accept a raw `{ messages }` object defensively in case of hand-edited data.
 */
interface PersistedDocumentQaState {
  messages?: unknown;
}

interface LegacyPersistedBlob {
  state?: PersistedDocumentQaState;
  version?: number;
  // Defensive: also allow raw messages at the top level.
  messages?: unknown;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowMs(): number {
  return Date.now();
}

/** Safe JSON parse that never throws. Returns `null` on any error / non-object. */
function safeJsonParse<T = unknown>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function coerceMessages(value: unknown): QAMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is QAMessage =>
    Boolean(m) &&
    typeof m === "object" &&
    typeof (m as QAMessage).id === "string" &&
    typeof (m as QAMessage).role === "string" &&
    typeof (m as QAMessage).content === "string" &&
    typeof (m as QAMessage).timestamp === "number"
  );
}

/**
 * Derive a human-friendly title for a session. Returns the first user prompt
 * (truncated), else the focus document name, else the placeholder. Callers
 * should only overwrite the title via this function when the current title is
 * still the placeholder, so user-chosen titles are preserved.
 */
export function deriveSessionTitle(
  messages: QAMessage[],
  documentName?: string,
): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser && firstUser.content.trim()) {
    const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
    return trimmed.length > TITLE_MAX_CHARS
      ? `${trimmed.slice(0, TITLE_MAX_CHARS)}…`
      : trimmed;
  }
  if (documentName && documentName.trim()) {
    const trimmed = documentName.trim();
    return trimmed.length > TITLE_MAX_CHARS
      ? `${trimmed.slice(0, TITLE_MAX_CHARS)}…`
      : trimmed;
  }
  return PLACEHOLDER_TITLE;
}

export function isPlaceholderTitle(title: string): boolean {
  return !title || title === PLACEHOLDER_TITLE;
}

function withCaps(session: DocumentQaSession): DocumentQaSession {
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  };
}

/**
 * Create a fresh session record. `partial` may seed initial selections/messages
 * (e.g. when migrating the legacy conversation).
 */
export function createSession(
  partial: Partial<Omit<DocumentQaSession, "id" | "createdAt" | "updatedAt" | "title">> & {
    title?: string;
  } = {},
): DocumentQaSession {
  const now = nowMs();
  const messages = coerceMessages(partial.messages);
  const session: DocumentQaSession = {
    id: generateId(),
    title: partial.title && partial.title.trim() ? partial.title.trim() : PLACEHOLDER_TITLE,
    createdAt: now,
    updatedAt: now,
    selectedDocumentId: partial.selectedDocumentId ?? "",
    webSearchEnabled: partial.webSearchEnabled ?? false,
    messages,
    messageCount: partial.messageCount ?? messages.length,
    documentName: partial.documentName,
  };

  // If the caller left the title as the placeholder but provided enough signal,
  // derive a better title up front.
  if (isPlaceholderTitle(session.title)) {
    session.title = deriveSessionTitle(messages, partial.documentName);
  }
  return withCaps(session);
}

/** Load all sessions from storage, sorted most-recently-updated first. */
export function loadSessions(): DocumentQaSession[] {
  if (typeof localStorage === "undefined") return [];
  const list = safeJsonParse<unknown[]>(localStorage.getItem(STORAGE_KEYS.sessions));
  if (!Array.isArray(list)) return [];
  const sessions = list
    .map((raw) => normalizeSession(raw))
    .filter((s): s is DocumentQaSession => s !== null);
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions.slice(0, MAX_SESSIONS);
}

/** Normalize an unknown persisted record into a session, or `null` if unusable. */
function normalizeSession(value: unknown): DocumentQaSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DocumentQaSession> & { messages?: unknown };
  if (typeof raw.id !== "string" || !raw.id) return null;
  const messages = coerceMessages(raw.messages);
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title ? raw.title : PLACEHOLDER_TITLE,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : nowMs(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : nowMs(),
    selectedDocumentId:
      typeof raw.selectedDocumentId === "string" ? raw.selectedDocumentId : "",
    webSearchEnabled: typeof raw.webSearchEnabled === "boolean" ? raw.webSearchEnabled : false,
    messages,
    messageCount: typeof raw.messageCount === "number" ? raw.messageCount : messages.length,
    documentName: typeof raw.documentName === "string" ? raw.documentName : undefined,
  };
}

/**
 * Persist the session list (capped, most-recent first). Also recomputes
 * denormalized metadata for sessions whose title is still the placeholder.
 */
export function saveSessions(sessions: DocumentQaSession[]): void {
  if (typeof localStorage === "undefined") return;
  const capped = sessions
    .map((s) => {
      const title = isPlaceholderTitle(s.title)
        ? deriveSessionTitle(s.messages, s.documentName)
        : s.title;
      return withCaps({ ...s, title, messageCount: s.messages.length });
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(capped));
  } catch (error) {
    // Quota errors etc. — surface to console but never crash the tab.
    console.error("Failed to persist Document Q&A sessions", error);
  }
}

export function getSession(id: string): DocumentQaSession | null {
  return loadSessions().find((s) => s.id === id) ?? null;
}

export function getActiveSessionId(): string | null {
  if (typeof localStorage === "undefined") return null;
  const id = localStorage.getItem(STORAGE_KEYS.activeSession);
  return id && typeof id === "string" ? id : null;
}

export function setActiveSessionId(id: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.activeSession, id);
}

/**
 * Update a session by id with a patch. Bumps `updatedAt`, recomputes
 * `messageCount` from messages when not explicitly provided, and re-derives the
 * title from messages/documentName when the current title is still the
 * placeholder. Persists the full list. Returns the updated session or `null`.
 */
export function updateSession(
  id: string,
  patch: Partial<Omit<DocumentQaSession, "id" | "createdAt">>,
): DocumentQaSession | null {
  const sessions = loadSessions();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const current = sessions[index];
  const mergedMessages =
    patch.messages !== undefined ? coerceMessages(patch.messages) : current.messages;
  const documentName =
    patch.documentName !== undefined ? patch.documentName : current.documentName;

  const title =
    patch.title !== undefined
      ? patch.title
      : isPlaceholderTitle(current.title)
        ? deriveSessionTitle(mergedMessages, documentName)
        : current.title;

  const updated: DocumentQaSession = {
    ...current,
    ...patch,
    messages: mergedMessages,
    documentName,
    title,
    messageCount: patch.messageCount ?? mergedMessages.length,
    updatedAt: nowMs(),
  };

  sessions[index] = updated;
  saveSessions(sessions);
  return updated;
}

/** Rename a session (user-initiated). Persists and returns the updated session. */
export function renameSession(id: string, title: string): DocumentQaSession | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  return updateSession(id, { title: trimmed });
}

/**
 * Delete a session by id. Returns the new active session id:
 * - if the deleted session was active, a fresh empty session is created and
 *   made active, and its id is returned;
 * - otherwise the current active id is returned unchanged.
 */
export function deleteSession(id: string): string {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);

  const activeId = getActiveSessionId();
  if (activeId !== id) return activeId ?? ensureActiveSession();

  // Deleted session was active — spin up a fresh empty one.
  const fresh = createSession();
  saveSessions([fresh, ...sessions]);
  setActiveSessionId(fresh.id);
  return fresh.id;
}

/**
 * Ensure there is an active session: if none exists, create an empty one,
 * persist it, and mark it active. Always returns a valid active session id.
 */
export function ensureActiveSession(): string {
  const existing = getActiveSessionId();
  const sessions = loadSessions();
  if (existing && sessions.some((s) => s.id === existing)) return existing;

  const fresh = createSession();
  saveSessions([fresh, ...sessions]);
  setActiveSessionId(fresh.id);
  return fresh.id;
}

/**
 * Read the persisted legacy `messages` blob (written by the Zustand `persist`
 * middleware for `useDocumentQAStore`) and coerce it to a messages array.
 * Accepts both the wrapped `{ state: { messages } }` shape and a raw
 * `{ messages }` object. Returns `null` when nothing usable is present.
 */
function readLegacyMessages(): QAMessage[] | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_STORAGE_KEYS.state);
  if (!raw) return null;
  const parsed = safeJsonParse<LegacyPersistedBlob>(raw);
  if (!parsed) return null;

  const messagesCandidate =
    (parsed.state && parsed.state.messages) ?? parsed.messages;
  const messages = coerceMessages(messagesCandidate);
  return messages;
}

/**
 * One-time migration of the legacy single-blob conversation state into a
 * default session. Runs only when no sessions exist yet but legacy state is
 * present. Leaves the legacy key intact (read-only) for rollback. Never
 * throws: malformed legacy data falls back to an empty session.
 *
 * Returns the active session id after migration (or `null` if it did not run
 * because sessions already existed and none was active).
 */
export function migrateLegacyState(): string | null {
  if (typeof localStorage === "undefined") return null;

  const existingSessions = loadSessions();
  if (existingSessions.length > 0) {
    // Sessions model already initialized — just make sure something is active.
    const active = getActiveSessionId();
    if (active && existingSessions.some((s) => s.id === active)) return active;
    const fallback = existingSessions[0];
    setActiveSessionId(fallback.id);
    return fallback.id;
  }

  const legacyMessages = readLegacyMessages();
  if (!legacyMessages || legacyMessages.length === 0) {
    // Nothing to migrate — create the initial empty session.
    return ensureActiveSession();
  }

  try {
    const migrated = createSession({
      messages: legacyMessages,
      title: deriveSessionTitle(legacyMessages, undefined),
    });

    saveSessions([migrated]);
    setActiveSessionId(migrated.id);
    return migrated.id;
  } catch (error) {
    // Malformed legacy state — never crash; start fresh.
    console.warn("Document Q&A legacy state migration failed, starting fresh.", error);
    return ensureActiveSession();
  }
}
