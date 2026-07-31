## 1. Session store module

- [x] 1.1 Create `src/components/review/flashcardStudioSessions.ts` exporting the `FlashcardStudioSession` type (id, title, createdAt, updatedAt, selectedProviderId/NotebookId/DocumentId/DeckId, contextSelection, messages, draftCards, cardCount, documentName) and the `STORAGE_KEYS` constants (`flashcard-studio-sessions-v1`, `flashcard-studio-active-session-v1`).
- [x] 1.2 Implement pure helpers: `loadSessions()`, `saveSessions(list)`, `getActiveSessionId()`, `setActiveSessionId(id)`, `getSession(id)`, `createSession(partial?)`, `updateSession(id, patch)` (recomputes updatedAt/cardCount/documentName), `deleteSession(id)`, `renameSession(id, title)`.
- [x] 1.3 Implement `migrateLegacyState()`: if no sessions exist but `flashcard-studio-state-v3` (and/or `flashcard-studio-history`) is present, build a default session from the legacy blob, set it active, and persist; on parse failure, fall back to an empty session (no throw). Leave legacy keys in place.
- [x] 1.4 Implement `deriveSessionTitle(session)`: first user message truncated to ~60 chars, else selected document title, else placeholder `"New session"`. Used by `updateSession` only when the title is still the placeholder.
- [x] 1.5 Add unit tests (`flashcardStudioSessions.test.ts`) for create/update/delete, active-id get/set, title derivation rules, and legacy migration (valid blob → default session; malformed blob → empty session).

## 2. Wire the store into FlashcardStudioModal

- [x] 2.1 Add `activeSessionId` state to `FlashcardStudioModal`; replace the load effect (~line 3101) so it migrates legacy state on first run, then hydrates `messages`, `draftCards`, `contextSelection`, and the selected provider/notebook/document/deck from the active session record.
- [x] 2.2 Re-scope the existing debounced save effect (~line 3136) to write current component state back into the active session record via `updateSession(activeSessionId, {...})`; ensure it writes before any session switch to avoid stale-debounce races (flush on switch).
- [x] 2.3 Keep `handleSend`'s history replay (~line 3848) unchanged in shape — verify it still reads `messages` from the active session only (no cross-session leakage) and that generated cards are recorded against the active session.
- [x] 2.4 Ensure seeds (`FlashcardStudioSeed`) apply to the active session: if a seed arrives while a non-empty session is active, treat it as triggering a new session (carrying the seed's draft), reusing the new-session flow in §3.

## 3. New-session action and context-window clearing

- [x] 3.1 Add a "New session" control to the Studio header (e.g. a `Plus`/`Lightning` button near the History/Sessions tab) with the `flashcardStudio.newSession` label; add a `Cmd/Ctrl+Shift+N` keyboard shortcut in the existing keydown handler (~line 3185).
- [x] 3.2 Implement `handleNewSession()`: flush-save the current session, then create a blank session (`createSession()`), set it active, hydrate to a clean slate (empty messages/drafts, default context selection), and switch `viewMode` to `"chat"`.
- [x] 3.3 Add a confirmation dialog when the active session has drafts that were never persisted to the learning-item DB (`alreadyPersisted !== true`): choices "Keep drafts" (copy current drafts into the new session) / "Start clean" / "Cancel". Skip the dialog when there are no unsaved drafts.
- [x] 3.4 Add i18n keys for all new strings (`newSession`, `newSessionShortcut`, `discardUnsavedDraftsTitle/Body`, `keepDrafts`, `startClean`, `cancel`) across `en`, `es`, `fr`, `de`, `ja`, `zh`.

## 4. Sessions view (replaces flat History view)

- [x] 4.1 Rename/repurpose the `viewMode === "history"` panel (~line 4906) into a Sessions view backed by `loadSessions()`; keep the tab but relabel to "Sessions" (`flashcardStudio.sessions`).
- [x] 4.2 Render each session row with: auto/user title, relative last-updated time (reuse `formatRelativeTime`), card count, source document name; visually mark the active session.
- [x] 4.3 Implement row actions: **Resume** (loads the session via §5 and switches to chat view), **Rename** (inline edit → `renameSession`), **Delete** (confirm dialog → `deleteSession`; if deleting the active session, create+activate an empty session).
- [x] 4.4 Implement the empty-state (no sessions): icon + message explaining that starting a session or generating cards creates one.
- [x] 4.5 Add i18n keys for the view: `sessions`, `sessionsDesc`, `resume`, `rename`, `deleteSession`, `deleteSessionConfirm`, `activeSessionLabel`, `sessionsEmpty`, `sessionsCapNote`.

## 5. Resume with full state

- [x] 5.1 Implement `handleResumeSession(id)`: flush-save the outgoing session, set the target active via `setActiveSessionId`, hydrate its full state (messages, drafts, context selection, provider/notebook/document/deck) into component state, and switch `viewMode` to `"chat"`.
- [x] 5.2 Verify that after resume, a new prompt uses the resumed session's chat history as LLM context and the response/cards are saved back to that session (covers the "follow-up prompts use resumed history" scenario).
- [x] 5.3 Ensure selecting a document/deck/provider or changing context while in a resumed session updates that session record (not a new one).

## 6. Migration safety and caps

- [x] 6.1 Enforce caps in `saveSessions`: keep at most 50 sessions (drop oldest by `updatedAt`); per-session messages capped at 50 and draftCards at 100 (matches current behavior).
- [x] 6.2 Verify the legacy keys (`flashcard-studio-state-v3`, `flashcard-studio-history`) are left intact on migration (read-only) so rollback within one release is possible; stop reading them after migration.
- [x] 6.3 Add a guard so a malformed or missing active-session id falls back to creating an empty session rather than rendering a blank/broken Studio.

## 7. Tests and verification

- [x] 7.1 Unit tests for the session store module (§1.5) — create/update/delete/rename, active id, title derivation, migration paths, caps enforcement.
- [x] 7.2 Component test: starting a new session clears messages/drafts/context and preserves the prior session in the list.
- [x] 7.3 Component test: resuming a session restores messages, drafts, context, and document selection, and a follow-up send uses that session's history.
- [x] 7.4 Component test: legacy blob is migrated into a default active session on first load; malformed blob does not crash.
- [ ] 7.5 Manual smoke test: open Studio with existing chat/drafts (migration), create new session for a different document, generate, resume the old session, rename and delete — confirm no data loss and no cross-session context leakage.
