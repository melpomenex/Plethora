/**
 * Flashcard Studio sessions — client-side persistence of distinct Studio
 * workspaces. Each session groups the chat (`messages`), `draftCards`,
 * context selection, and selected document/deck/provider so the user can
 * start a clean context window for a new document/section without losing
 * past work, and resume a previous session later.
 *
 * Backed by `localStorage`. No backend/Rust involvement.
 *
 * Caps (matching the legacy single-blob behavior):
 * - at most `MAX_SESSIONS` sessions (oldest dropped by `updatedAt`)
 * - at most `MAX_MESSAGES_PER_SESSION` messages per session
 * - at most `MAX_DRAFTS_PER_SESSION` draft cards per session
 */

import type { ChatMessage, ContextSelection, DraftCard } from "./FlashcardStudioModal";
import { DEFAULT_CONTEXT_SELECTION, normalizeContextSelection } from "./FlashcardStudioModal";
import type { FlashcardTargetOverride } from "../../utils/flashcardTarget";

/** localStorage keys for the new sessions model. */
export const STORAGE_KEYS = {
  sessions: "flashcard-studio-sessions-v1",
  activeSession: "flashcard-studio-active-session-v1",
} as const;

/** Legacy keys retained read-only for one release as a migration source / rollback net. */
export const LEGACY_STORAGE_KEYS = {
  state: "flashcard-studio-state-v3",
  history: "flashcard-studio-history",
} as const;

export const MAX_SESSIONS = 50;
export const MAX_MESSAGES_PER_SESSION = 50;
export const MAX_DRAFTS_PER_SESSION = 100;

const PLACEHOLDER_TITLE = "New session";
const TITLE_MAX_CHARS = 60;

export interface FlashcardStudioSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  selectedProviderId: string | null;
  selectedNotebookId: string;
  selectedDocumentId: string | null;
  selectedDeckId: string | null;
  contextSelection: ContextSelection;
  messages: ChatMessage[];
  draftCards: DraftCard[];
  /** Denormalized count of cards produced in this session (derived from history/drafts). */
  cardCount: number;
  /** Denormalized source document name for the sessions list. */
  documentName?: string;
  /** Optional view mode restored on resume. */
  viewMode?: string;
  /**
   * Session-local override of the global flashcard generation target
   * (Settings → AI). Undefined means "use the current global default".
   */
  flashcardTargetOverride?: FlashcardTargetOverride;
}

/**
 * Shape of the persisted workspace before sessions existed. Used only for migration.
 * Mirrors what the old save effect wrote under LEGACY_STORAGE_KEYS.state.
 */
interface LegacyWorkspaceState {
  selectedProviderId?: string | null;
  selectedNotebookId?: string;
  selectedDocumentId?: string | null;
  selectedDeckId?: string | null;
  contextSelection?: unknown;
  messages?: unknown;
  draftCards?: unknown;
  viewMode?: string;
}

function generateId(): string {
  // Prefer the platform crypto uuid when available; fall back to timestamp+random.
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

function coerceMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is ChatMessage =>
    Boolean(m) && typeof m === "object" &&
    typeof (m as ChatMessage).id === "string" &&
    typeof (m as ChatMessage).role === "string" &&
    typeof (m as ChatMessage).content === "string"
  );
}

function coerceDraftCards(value: unknown): DraftCard[] {
  if (!Array.isArray(value)) return [];
  return value.filter((c): c is DraftCard =>
    Boolean(c) && typeof c === "object" && typeof (c as DraftCard).id === "string"
  );
}

/**
 * Derive a human-friendly title for a session. Returns the first user prompt
 * (truncated), else the document name, else the placeholder. Callers should only
 * overwrite the title via this function when the current title is still the
 * placeholder, so user-chosen titles are preserved.
 */
export function deriveSessionTitle(
  messages: ChatMessage[],
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

function withCaps(session: FlashcardStudioSession): FlashcardStudioSession {
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
    draftCards: session.draftCards.slice(0, MAX_DRAFTS_PER_SESSION),
  };
}

/**
 * Create a fresh session record. `partial` may seed initial selections/drafts
 * (e.g. when carrying drafts into a new session, or seeding from a document).
 */
export function createSession(
  partial: Partial<Omit<FlashcardStudioSession, "id" | "createdAt" | "updatedAt" | "title">> & { title?: string } = {},
): FlashcardStudioSession {
  const now = nowMs();
  const messages = coerceMessages(partial.messages);
  const draftCards = coerceDraftCards(partial.draftCards);
  const session: FlashcardStudioSession = {
    id: generateId(),
    title: partial.title && partial.title.trim() ? partial.title.trim() : PLACEHOLDER_TITLE,
    createdAt: now,
    updatedAt: now,
    selectedProviderId: partial.selectedProviderId ?? null,
    selectedNotebookId: partial.selectedNotebookId ?? "",
    selectedDocumentId: partial.selectedDocumentId ?? null,
    selectedDeckId: partial.selectedDeckId ?? null,
    contextSelection: partial.contextSelection
      ? normalizeContextSelection(partial.contextSelection)
      : { ...DEFAULT_CONTEXT_SELECTION },
    messages,
    draftCards,
    cardCount: partial.cardCount ?? draftCards.length,
    documentName: partial.documentName,
    viewMode: partial.viewMode,
    flashcardTargetOverride: partial.flashcardTargetOverride,
  };

  // If the caller left the title as the placeholder but provided enough signal,
  // derive a better title up front.
  if (isPlaceholderTitle(session.title)) {
    session.title = deriveSessionTitle(messages, partial.documentName);
  }
  return withCaps(session);
}

/** Load all sessions from storage, sorted most-recently-updated first. */
export function loadSessions(): FlashcardStudioSession[] {
  if (typeof localStorage === "undefined") return [];
  const list = safeJsonParse<unknown[]>(localStorage.getItem(STORAGE_KEYS.sessions));
  if (!Array.isArray(list)) return [];
  const sessions = list
    .map((raw) => normalizeSession(raw))
    .filter((s): s is FlashcardStudioSession => s !== null);
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions.slice(0, MAX_SESSIONS);
}

/** Normalize an unknown persisted record into a session, or `null` if unusable. */
function normalizeSession(value: unknown): FlashcardStudioSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<FlashcardStudioSession> & { messages?: unknown; draftCards?: unknown };
  if (typeof raw.id !== "string" || !raw.id) return null;
  const messages = coerceMessages(raw.messages);
  const draftCards = coerceDraftCards(raw.draftCards);
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title ? raw.title : PLACEHOLDER_TITLE,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : nowMs(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : nowMs(),
    selectedProviderId: typeof raw.selectedProviderId === "string" ? raw.selectedProviderId : null,
    selectedNotebookId: typeof raw.selectedNotebookId === "string" ? raw.selectedNotebookId : "",
    selectedDocumentId: typeof raw.selectedDocumentId === "string" ? raw.selectedDocumentId : null,
    selectedDeckId: typeof raw.selectedDeckId === "string" ? raw.selectedDeckId : null,
    contextSelection: raw.contextSelection
      ? normalizeContextSelection(raw.contextSelection)
      : { ...DEFAULT_CONTEXT_SELECTION },
    messages,
    draftCards,
    cardCount: typeof raw.cardCount === "number" ? raw.cardCount : draftCards.length,
    documentName: typeof raw.documentName === "string" ? raw.documentName : undefined,
    viewMode: typeof raw.viewMode === "string" ? raw.viewMode : undefined,
    flashcardTargetOverride:
      raw.flashcardTargetOverride && typeof raw.flashcardTargetOverride === "object"
        ? (raw.flashcardTargetOverride as FlashcardTargetOverride)
        : undefined,
  };
}

/**
 * Persist the session list (capped, most-recent first). Also recomputes
 * denormalized metadata for sessions whose title is still the placeholder.
 */
export function saveSessions(sessions: FlashcardStudioSession[]): void {
  if (typeof localStorage === "undefined") return;
  const capped = sessions
    .map((s) => {
      const title = isPlaceholderTitle(s.title)
        ? deriveSessionTitle(s.messages, s.documentName)
        : s.title;
      return withCaps({ ...s, title });
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(capped));
  } catch (error) {
    // Quota errors etc. — surface to console but never crash the Studio.
    console.error("Failed to persist Flashcard Studio sessions", error);
  }
}

export function getSession(id: string): FlashcardStudioSession | null {
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
 * `cardCount` from draftCards when not explicitly provided, and re-derives the
 * title from messages/documentName when the current title is still the
 * placeholder. Persists the full list. Returns the updated session or `null`.
 */
export function updateSession(
  id: string,
  patch: Partial<Omit<FlashcardStudioSession, "id" | "createdAt">>,
): FlashcardStudioSession | null {
  const sessions = loadSessions();
  const index = sessions.findIndex((s) => s.id === id);
  if (index === -1) return null;

  const current = sessions[index];
  const mergedMessages = patch.messages !== undefined ? coerceMessages(patch.messages) : current.messages;
  const mergedDrafts = patch.draftCards !== undefined ? coerceDraftCards(patch.draftCards) : current.draftCards;
  const documentName = patch.documentName !== undefined ? patch.documentName : current.documentName;

  const title = patch.title !== undefined
    ? patch.title
    : isPlaceholderTitle(current.title)
      ? deriveSessionTitle(mergedMessages, documentName)
      : current.title;

  const updated: FlashcardStudioSession = {
    ...current,
    ...patch,
    messages: mergedMessages,
    draftCards: mergedDrafts,
    documentName,
    title,
    cardCount: patch.cardCount ?? mergedDrafts.length,
    updatedAt: nowMs(),
  };

  sessions[index] = updated;
  saveSessions(sessions);
  return updated;
}

/** Rename a session (user-initiated). Persists and returns the updated session. */
export function renameSession(id: string, title: string): FlashcardStudioSession | null {
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
 * One-time migration of the legacy single-blob workspace state into a default
 * session. Runs only when no sessions exist yet but legacy state is present.
 * Leaves legacy keys intact (read-only) for rollback. Never throws: malformed
 * legacy data falls back to an empty session.
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

  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEYS.state);
  const legacy = safeJsonParse<LegacyWorkspaceState>(legacyRaw);

  if (!legacy) {
    // Nothing to migrate — create the initial empty session.
    return ensureActiveSession();
  }

  try {
    const messages = coerceMessages(legacy.messages);
    const draftCards = coerceDraftCards(legacy.draftCards);
    const migrated = createSession({
      selectedProviderId: typeof legacy.selectedProviderId === "string" ? legacy.selectedProviderId : null,
      selectedNotebookId: typeof legacy.selectedNotebookId === "string" ? legacy.selectedNotebookId : "",
      selectedDocumentId: typeof legacy.selectedDocumentId === "string" ? legacy.selectedDocumentId : null,
      selectedDeckId: typeof legacy.selectedDeckId === "string" ? legacy.selectedDeckId : null,
      contextSelection: (legacy.contextSelection ?? { ...DEFAULT_CONTEXT_SELECTION }) as ContextSelection,
      messages,
      draftCards,
      viewMode: typeof legacy.viewMode === "string" ? legacy.viewMode : undefined,
      title: deriveSessionTitle(messages, undefined),
    });

    saveSessions([migrated]);
    setActiveSessionId(migrated.id);
    return migrated.id;
  } catch (error) {
    // Malformed legacy state — never crash; start fresh.
    console.warn("Flashcard Studio legacy state migration failed, starting fresh.", error);
    return ensureActiveSession();
  }
}
