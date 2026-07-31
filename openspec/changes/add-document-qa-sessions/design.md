## Context

Document Q&A (`src/components/tabs/DocumentQATab.tsx`, ~1885 lines) is the primary chat surface for asking an LLM questions about a document or the whole library (RAG). Today it holds a **single global conversation**:

- `messages: QAMessage[]` lives in a Zustand store (`useDocumentQAStore`, `src/stores/documentQAStore.ts`) persisted via `zustand/middleware/persist` under `localStorage["incrementum-document-qa"]` (only `messages` is partialized; `isProcessing` is not persisted). The store exposes `addMessage` / `updateMessage` / `setMessages` / `clearMessages` / `setIsProcessing` / `updateToolCall`.
- A fixed **focus document** (`selectedDocumentId`) and a **web-search toggle** (`webSearchEnabled`) live as component `useState`, alongside composer state (`rawInput`, `mentions`, `selectedSections`, `detectedChapter`), the chapter/section focus, and the legacy NotebookLM research workspace.
- On each send, the last ~6 messages of `messages` are replayed into the LLM context window (`handleSendMessage` ~line 1319). There is no notion of a *session*: when the user switches from Document A to Document B, A's turns are still in the window, and the only reset is **Clear Chat** (`clearConversation` ~line 579 → `clearMessages()`), which **irreversibly destroys** the prior conversation. There is no history view, no resume, and no auto-title.

This change introduces **sessions** for Document Q&A, mirroring the model already shipped for AI Flashcard Studio (`add-flashcard-studio-sessions`, `src/components/review/flashcardStudioSessions.ts`) but adapted to Q&A's simpler shape: Q&A has **no draft pile** (cards are written straight to the DB via tool calls) and its persistence is **Zustand-`persist`** rather than a hand-rolled save effect — so the integration is smaller and lower-risk than Flashcard Studio's was.

Constraints:
- 100% client-side (`localStorage`). No Rust/backend changes.
- Must not lose the existing conversation — the legacy `messages` blob must migrate into a default session.
- The "good UX" requirement: history browsing and resume must feel native to a chat app (ChatGPT/Claude-style), not bolted on.
- Must coexist with the existing document mention (`@`), section focus (`#`), web-search, chapter-detection, and RAG paths — these read component state that sessions must (re)hydrate.

## Goals / Non-Goals

**Goals:**
- Let the user start a fresh conversation that clears the live LLM context window (chat + focus document) for a new document/topic, without losing past conversations.
- Persist and list past conversations in a **chat-app-native, collapsible sidebar** with enough metadata (auto-title, relative time, focus document) to find prior work.
- Resume a past conversation by restoring its messages and focus document — including making it the live context for follow-up turns.
- Migrate the existing single-blob persisted `messages` into a default session transparently.
- Keep the change additive and non-breaking for persisted learning items (sessions govern only the in-tab conversation state; tool-call-created cards/extracts keep writing to the DB).

**Non-Goals:**
- Server-side / cross-device sync of sessions (stays in `localStorage`; a future change can lift it into the sync layer).
- Pinning / favoriting sessions, folder organization, or search-within-session (defer; the sidebar is flat, sorted by recency).
- A draft pile (Q&A has none; Flashcard Studio's draft-carryover confirmation is therefore not needed here).
- Changing the spaced-repetition Review session (`flashcard-review-session` spec) — a different surface.
- Carrying composer draft text (`rawInput` / `mentions` / `selectedSections`) across sessions — composer state resets per session exactly as it does today on Clear Chat.

## Decisions

### Decision 1: Sessions as a client-side store module, mirroring the Flashcard Studio pattern

Introduce a small TS module `src/components/tabs/documentQaSessions.ts` (sibling/peer of `flashcardStudioSessions.ts`) backed by `localStorage` with two keys:
- `document-qa-sessions-v1`: an array of session records (capped, e.g. last 50).
- `document-qa-active-session-v1`: the active session id.

A session record holds the conversation plus the small amount of focus/UI state worth restoring:
```
type DocumentQaSession = {
  id: string;
  title: string;            // auto-derived, user-renameable
  createdAt: number;
  updatedAt: number;
  selectedDocumentId: string;   // "" = Whole Library (RAG)
  webSearchEnabled: boolean;
  messages: QAMessage[];        // capped, e.g. last 50 (matches today's effective replay)
  // denormalized for the list view, derived on save:
  messageCount: number;
  documentName?: string;        // resolved focus-doc title, or "Whole Library"
};
```

The module exposes pure helpers (`loadSessions`, `saveSessions`, `getActiveSessionId`, `setActiveSessionId`, `getSession`, `createSession`, `updateSession`, `deleteSession`, `renameSession`, `ensureActiveSession`, `migrateLegacyState`, `deriveSessionTitle`) so the component stays thin and the logic is unit-testable. Each helper validates/coerces unknown persisted records defensively (a malformed session never crashes the tab), exactly as `flashcardStudioSessions.ts` does.

**Rationale / alternatives:** Reusing the Flashcard Studio module's *shape* (not the file) keeps two parallel features consistent and low-risk; the Q&A module drops the draft/deck/provider/contextSelection fields Q&A doesn't have. Alternative considered: lift sessions into a shared generic `chatSessionStore`. Rejected for now — the two surfaces differ enough (drafts, decks, providers, context modes vs. none) that premature abstraction would be churn; a shared helper can be extracted later if a third sessionized surface appears.

### Decision 2: The active session id is the source of truth; the Zustand store becomes the live buffer for the active session

Keep `useDocumentQAStore` as the **live, in-memory conversation buffer** the component already reads/writes (`messages`, `addMessage`, `updateToolCall`, …) — but **stop persisting it directly**. The session store becomes the persistence layer:
- On tab open (or when `activeSessionId` changes), a load effect calls `migrateLegacyState()` once if needed, then hydrates the store + focus state from the active session record: `setMessages(session.messages)`, `setSelectedDocumentId(session.selectedDocumentId)`, `setWebSearchEnabled(session.webSearchEnabled)`.
- A debounced save effect writes the current `messages` (+ focus doc, web-search) back into the active session record via `updateSession(activeSessionId, {...})`, bumping `updatedAt` and recomputing `messageCount`/`documentName`/title.
- `useDocumentQAStore`'s `persist` partialization is changed to persist **nothing new** (the session store owns persistence). To preserve a migration/rollback net, the `incrementum-document-qa` key is left in place and read once by `migrateLegacyState`; it is no longer written going forward. (If we remove `persist` entirely we lose nothing the session store doesn't already capture, but keeping the middleware inactive is the smaller diff and avoids touching store consumers elsewhere.)

This keeps the component's existing `messages`-driven wiring — `handleSendMessage`'s history replay (~line 1319), message rendering, tool-call execution — **unchanged in shape**; only the persistence target moves from "the Zustand blob" to "the active session record."

**Rationale:** Minimal rewrite of a large, busy component. The context-clearing the user asked for falls out for free: switching/creating a session swaps the hydrated store contents, so the replayed history is naturally scoped to the active session.

### Decision 3: "New chat" creates an empty session and switches to it — no draft-carryover dialog (Q&A has no drafts)

`handleNewChat()` flush-saves the current session, then `createSession()` makes a new blank record (new id, empty `messages`, default focus = current focus doc or `""`, `webSearchEnabled = false`, title = placeholder), sets it active, and hydrates the store to a clean slate (`clearMessages()`-equivalent + reset focus/composer). The previous conversation is preserved as a resumable past session.

Because Document Q&A has **no unsaved draft pile** (cards/extracts are written straight to the DB by tool calls as they're produced), there is **no "you have unsaved drafts" confirmation** — unlike Flashcard Studio. A confirmation is still shown only if the *composer currently has typed text* (`rawInput.trim()` non-empty), framed as "clear the current message?" — the same affordance Clear Chat implies today, never losing sent history.

**Rationale:** The user's explicit ask is a clean context for a new document/topic. Sent conversation history is always preserved into the outgoing session, so the only thing "lost" on New Chat is an un-sent draft message — which warrants at most a lightweight guard, matching today's Clear Chat mental model.

### Decision 4: Chat-app-native collapsible sessions sidebar (the "good UX" surface)

Add a **left sidebar rail** to the Document Q&A tab — the layout users expect from modern chat apps:
- Collapsible (toggle button / `Cmd/Ctrl+Shift+\` or a dedicated collapse control), collapsed state persisted to `localStorage`.
- Header: **"New chat"** button (primary affordance) + the collapse toggle.
- Body: scrollable list of sessions from `loadSessions()` (most-recent first), each row showing auto/user title, relative last-updated time, and focus-document label ("Whole Library" when `selectedDocumentId` is empty). The active session is visually highlighted.
- Row hover actions: **Rename** (inline edit → `renameSession`) and **Delete** (trash → confirm → `deleteSession`; if deleting the active session, create + activate an empty session per `deleteSession`'s contract). Clicking a row **resumes** that session.
- Empty state: icon + copy explaining that sending a message or starting a new chat creates a session; includes the cap note (e.g. "most recent 50 conversations kept").

A second, lightweight **"New chat"** affordance stays in the existing header next to "Clear Chat" so it's discoverable without opening the sidebar, plus the `Cmd/Ctrl+Shift+K` shortcut. The existing "Clear Chat" button is retained but re-scoped: in a sessionized world it clears the *active* session's messages in place (or, equivalently, starts a new chat) — kept mainly for muscle memory, with its tooltip/title clarified.

**Rationale:** The user emphasized "IN A GOOD UX WAY." A collapsible sidebar is the canonical chat-history pattern and is strictly better than the modal/flat-list Flashcard Studio used (Q&A is a full tab, so it has room for a persistent rail). Resume-with-full-state is the core of "find what they were working on and pick up where they left off."

### Decision 5: Auto-title from first user prompt or focus document; user-renameable

When a session is saved and its `title` is still the placeholder, derive it from: (a) the first user `messages` entry (truncated to ~60 chars), or (b) if no messages yet, the focus document's title (or "Whole Library"), or (c) keep placeholder. The user can rename at any time (stored on the record); auto-derivation never overwrites a user-set title.

**Rationale:** A history list is useless without identifiable labels, and auto-derivation matches user expectation ("the conversation about Document X") with zero effort — identical to the proven Flashcard Studio behavior.

### Decision 6: One-time migration of the legacy `messages` blob into a default session

On first load, if `document-qa-sessions-v1` is absent *but* `incrementum-document-qa` is present and contains a `messages` array, create a single session seeded from that blob (messages coerced defensively, focus doc left at default since the legacy blob didn't store it, title derived from first prompt or "Imported conversation"), set it active, and write the new keys. The legacy key is left in place (read-only) for one release as a rollback net; it is no longer written going forward. Malformed data → fresh empty session (no throw).

**Rationale:** Silent data loss on upgrade is the worst outcome. A read-only migration into the first session is cheap and reversible.

## Risks / Trade-offs

- **`localStorage` size growth with many sessions** → Cap stored sessions (50) and messages per session (50, matching today's effective replay window). Oldest sessions beyond the cap are dropped on save. Document the limit in the empty-state copy.
- **Migration correctness** → If the legacy `incrementum-document-qa` blob is malformed, fall back to a fresh empty session rather than crashing; log a warning. Migration is additive (legacy key retained read-only for one release).
- **Race between debounced save and rapid session switching** → Flush (synchronous save) the outgoing session *before* hydrating the incoming one on switch/new/delete, so no writes are lost to a stale debounce firing after `activeSessionId` has changed.
- **Two persistence layers during the transition (Zustand `persist` + session store)** → Make the session store the single writer; neutralize the Zustand `persist` write (or scope it to nothing) so the two can't diverge. The legacy key is read once for migration and then ignored.
- **Sidebar encroaches on chat width** → Make it collapsible and remember the collapsed state; default open on wide viewports, collapsed on narrow ones.
- **Naming collision with "Review session" / "Studio session"** → UI copy uses "conversation"/"chat history" in the Q&A tab (e.g. "New chat", "Chat history") rather than bare "session", to avoid confusing it with Flashcard Studio or the Review queue. The spec/code capability name is still `document-qa-sessions`.
- **Tool-call side effects during a resumed session** → Resume only restores conversation/focus; tool calls already wrote their cards/extracts to the DB when first produced and are not re-executed on resume (they show their persisted success/error status).

## Migration Plan

1. Ship the session store + migration + sidebar behind the existing Document Q&A tab (no new entry points).
2. On first open post-upgrade, the legacy `messages` blob becomes the default session; the user sees no change except a new sidebar containing their current conversation.
3. After one release, stop reading `incrementum-document-qa` (key may be left as cold data); the session store is the sole source of truth.
4. Rollback: if needed, the legacy key still holds the pre-session `messages` for that one release; reverting the code restores the old single-blob behavior.

## Open Questions

- Keyboard shortcut for "New chat": `Cmd/Ctrl+Shift+K` (K = konversation/new chat, avoids clashing with `N` used by Flashcard Studio's New session). Lean: yes. (Wiring into the command palette can follow the `add-contextual-command-palette-actions` change.)
- Whether the focus document should be **per-session** (restored on resume) or **global** (one focus across all chats). Lean: **per-session**, since it's the most useful resume behavior and matches "the conversation about Document X." This is the model assumed above; if global is preferred, drop `selectedDocumentId` from the record.
- Hard cap on stored sessions (50?) and whether to surface "oldest conversations will be dropped" in the UI. Lean: cap at 50, mention in empty-state.
