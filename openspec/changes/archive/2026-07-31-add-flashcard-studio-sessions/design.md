## Context

The AI Flashcard Studio (`src/components/review/FlashcardStudioModal.tsx`, ~5300 lines) is the primary surface for generating flashcards from documents/sections via an LLM. Today it holds a **single global workspace**: one `messages: ChatMessage[]` chat (replayed as the last ~10 turns into the LLM context on every send — see `handleSend` ~line 3848), one `draftCards: DraftCard[]` pile, and one `contextSelection` / document / deck / provider selection. All of this is persisted as a single JSON blob under `localStorage["flashcard-studio-state-v3"]` (save effect ~line 3136), with a separate flat prompt log under `localStorage["flashcard-studio-history"]`.

The pain point: there is no notion of a *session*. When a user moves from generating cards for Document A to Document B, Document A's chat turns are still in the context window (the model keeps referencing A), A's drafts are still in the pile, and the only "reset" is to manually clear chat + delete drafts. The "History" view only shows one-line prompt summaries and can restore a prompt string — it cannot restore the conversation, drafts, document, deck, or context focus that produced those cards.

This change introduces **sessions**: bounded, persistent units of "the cards I'm creating from this document/section right now," each encapsulating chat + drafts + context, with the ability to start a clean one and resume a past one.

Constraints:
- 100% client-side (`localStorage`). No Rust/backend changes.
- Must not lose existing user data — the legacy single-blob state must migrate into a default session.
- Must coexist with the recently-added `sections` context mode and `FlashcardStudioSeed` entry points (e.g. "make a card from this extract/image") — seeding should target a session.

## Goals / Non-Goals

**Goals:**
- Let the user start a fresh session that clears the live LLM context window (chat + drafts + section/chapter focus) for a new document/section, without losing past sessions.
- Persist and list past sessions with enough metadata (auto-title, timestamp, card counts, source document) to find prior work.
- Resume a past session by restoring its chat, drafts, document, deck, provider, and context selection — including making it the live context for follow-up turns.
- Migrate the existing single-blob persisted state into a default session transparently.
- Keep the change additive and non-breaking for persisted learning items (sessions govern only the in-Studio workspace state, not the card DB).

**Non-Goals:**
- Server-side / cross-device sync of sessions (stays in `localStorage`; a future change can lift it into the sync layer).
- Auto-archiving or expiring old sessions (the user deletes explicitly; we cap the stored count to avoid unbounded growth).
- Changing the spaced-repetition Review session (`flashcard-review-session` spec) — that is a different surface.
- Multi-user or named workspaces; sessions are personal and auto-titled.

## Decisions

### Decision 1: Sessions as a client-side store, replacing the two legacy `localStorage` blobs

Introduce a `FlashcardStudioSessionStore` (a small TS module, e.g. `src/components/review/flashcardStudioSessions.ts`) backed by `localStorage` with two keys:
- `flashcard-studio-sessions-v1`: an array of session records (capped, e.g. last 50).
- `flashcard-studio-active-session-v1`: the active session id.

A session record holds exactly what the current single-blob state holds, plus identity/metadata:
```
type FlashcardStudioSession = {
  id: string;
  title: string;            // auto-derived, user-renameable
  createdAt: number;
  updatedAt: number;
  selectedProviderId, selectedNotebookId, selectedDocumentId, selectedDeckId;
  contextSelection: ContextSelection;
  messages: ChatMessage[];   // capped, e.g. last 50 (matches today's save)
  draftCards: DraftCard[];   // capped, e.g. 100 (matches today's save)
  // denormalized for the list view, derived on save:
  cardCount, documentName;
};
```

**Rationale / alternatives:** The existing save effect already serializes exactly these fields into one blob — generalizing "one blob" to "N keyed records" is the smallest possible delta to the persistence model. Alternative considered: a Zustand store with `persist` middleware. Rejected for now because the modal already manages this state locally via `useState` and a manual save effect; introducing a persisted store is a larger refactor with no behavioral gain at this scope. The store module exposes pure load/save/list/create/delete/rename helpers so the component stays thin and the logic is unit-testable.

### Decision 2: The active session id is the source of truth; component state mirrors one session

The modal keeps `activeSessionId` in state. On open (or when `activeSessionId` changes), a load effect hydrates `messages`, `draftCards`, `contextSelection`, etc. from that session record. The existing debounced save effect is re-scoped to write the *current* component state back into the session record keyed by `activeSessionId` (and bumps `updatedAt` / recomputes `cardCount` + `documentName`). This keeps the existing per-field `useState` wiring and the `handleSend` history-replay (~line 3848) unchanged in shape — they still read `messages`/`draftCards`/`contextSelection`; only the persistence target changes from "the blob" to "the active session record."

**Rationale:** Minimal rewrite of the 5300-line component. The context-window-clearing the user asked for falls out for free: switching/creating a session swaps the hydrated state, so `messages` (and thus the replayed history) is naturally scoped to the active session.

### Decision 3: "New session" creates an empty record and switches to it; unsaved drafts are not carried over by default

`createSession()` makes a new blank record (new id, empty `messages`/`draftCards`, default `contextSelection`, title = "New session" placeholder), sets it active, and hydrates the component to a clean slate. If the current session has unsaved *persisted* learning items in flight we do not block (those are already in the DB); but any **unsaved drafts** in the current session are left behind in that session's record (which is the whole point — they're saved *into* the session, not lost). A confirmation dialog is shown only when the current session has drafts that have never been saved to the DB, to prevent accidental abandonment; the user can choose "keep drafts" (copy them into the new session) or "start clean."

**Rationale / alternatives:** The user's explicit use case is "clear the context window for a new document/section" — so the default must be a clean context. But silently discarding in-progress drafts would be hostile, hence the targeted confirmation only when unsaved drafts exist. Alternative considered: always carry drafts forward — rejected because it re-contaminates the new session's draft pile, the exact problem being solved.

### Decision 4: Sessions list view replaces the flat History view; resume restores full state

The existing `viewMode === "history"` panel (which only lists `GenerationHistoryItem` prompt summaries and restores a prompt string) is upgraded into a **Sessions** view. Each row shows auto-title, relative time, card count, and source document; clicking **Resume** loads that session's full state (chat, drafts, context, document, deck, provider) into the component and switches `viewMode` to `chat`. Row actions: **Rename** (inline edit of `title`) and **Delete** (with confirm). The old per-prompt `GenerationHistoryItem` log is folded into session metadata (a session's first user prompt already drives its auto-title), so the separate `flashcard-studio-history` key is deprecated after migration.

**Rationale:** The user asked specifically to "maintain history of past sessions so the user can find what they were working on and pick up from where they left off." Resume-with-full-state is the core of that; the old prompt-only log is a strict subset and is subsumed.

### Decision 5: Auto-title from first user prompt or selected document; user-renameable

When a session is saved and its `title` is still the placeholder ("New session"), derive a title from: (a) the first user `messages` entry (truncated to ~60 chars), or (b) if no messages yet, the selected document's title, or (c) keep placeholder. The user can rename at any time (stored on the record). This gives the list view meaningful, searchable labels with zero user effort.

**Rationale:** A sessions list is useless without identifiable labels. Auto-derivation matches user expectation ("the thing I was doing with Document X") and mirrors how the current History item shows `documentName`.

### Decision 6: One-time migration of legacy state into a default session

On first load, if `flashcard-studio-sessions-v1` is absent *but* `flashcard-studio-state-v3` (and/or `flashcard-studio-history`) is present, create a single session record seeded from the legacy blob (messages, drafts, selections, title = derived or "Imported session"), set it active, and write the new keys. The legacy keys are left in place (not deleted) for one release as a safety net, then ignored. No data is lost; the user sees their existing chat/drafts as a resumable session.

**Rationale:** Silent data loss on upgrade is the worst outcome. A read-only migration into the first session is cheap and fully reversible.

## Risks / Trade-offs

- **`localStorage` size growth with many sessions** → Cap stored sessions (e.g. 50) and messages/drafts per session (matches today's caps). Oldest sessions beyond the cap are dropped on save. Document this limit in the empty-state copy.
- **Migration correctness** → If the legacy blob is malformed, fall back to a fresh empty session rather than crashing; log a warning. Migration is additive (legacy keys retained for one release).
- **Race between debounced save and rapid session switching** → Flush (synchronous save) the outgoing session *before* hydrating the incoming one on switch/create, so no writes are lost to a stale debounce firing after `activeSessionId` has changed.
- **Confusion between "Studio session" and "Review session"** → Naming in the UI avoids the word "session" in isolation; use "Studio session" / "workspace" in copy, and keep the Review-tab session untouched. The new spec is `flashcard-studio-sessions`, distinct from `flashcard-review-session`.
- **Seed entry points (`FlashcardStudioSeed`) targeting the wrong session** → Seeds apply to the *active* session; if a seed arrives while a non-empty session is active, treat it like a "new session" trigger (optionally carrying the seed's draft). Documented in tasks.
- **Large component, high blast radius** → Keep the refactor surgical: extract persistence into the new module, rewire the two existing effects (load ~3101, save ~3136), and add UI. Do not rewrite card parsing, context resolution, or sending logic.

## Migration Plan

1. Ship the session store + migration + UI behind the existing component (no new entry points).
2. On first open post-upgrade, the legacy blob becomes the default session; the user sees no change except a new "Sessions" view containing their current work.
3. After one release, stop reading `flashcard-studio-state-v3` / `flashcard-studio-history` (keys may be left as cold data).
4. Rollback: if needed, the legacy keys still hold the pre-session data for that one release; reverting the code restores the old single-blob behavior.

## Open Questions

- Should there be a keyboard shortcut for "New session" (e.g. `Cmd/Ctrl+Shift+N`), and should switching sessions be added to the command palette? (Lean: yes to the shortcut, defer palette wiring to the `add-contextual-command-palette-actions` change.)
- Hard cap on stored sessions (50?) and whether to surface "oldest sessions will be dropped" in the UI. (Lean: cap at 50, mention in empty-state.)
