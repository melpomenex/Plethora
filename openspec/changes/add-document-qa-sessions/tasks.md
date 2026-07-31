## 1. Session store module

- [x] 1.1 Create `src/components/tabs/documentQaSessions.ts` exporting the `DocumentQaSession` type (id, title, createdAt, updatedAt, selectedDocumentId, webSearchEnabled, messages, messageCount, documentName) and the `STORAGE_KEYS` constants (`document-qa-sessions-v1`, `document-qa-active-session-v1`); define `LEGACY_STORAGE_KEYS.state = "incrementum-document-qa"` for migration.
- [x] 1.2 Implement pure helpers: `loadSessions()` (sorted most-recent first, capped), `saveSessions(list)` (enforces caps, re-derives title from placeholder only), `getActiveSessionId()`, `setActiveSessionId(id)`, `getSession(id)`, `createSession(partial?)`, `updateSession(id, patch)` (recomputes updatedAt/messageCount/documentName/title), `deleteSession(id)` (creates+activates an empty session if the deleted one was active), `renameSession(id, title)`, `ensureActiveSession()`.
- [x] 1.3 Implement defensive coercion: `coerceMessages(value)` (filter to valid `QAMessage` with string id/role/content + number timestamp), `normalizeSession(value)` (returns `null` on any unusable record), `safeJsonParse` that never throws. A malformed record must never crash the tab.
- [x] 1.4 Implement `migrateLegacyState()`: if no sessions exist but `incrementum-document-qa` holds a `messages` array, build a default session from it (coerced messages, title = derived or "Imported conversation"), set it active, persist; on parse failure, fall back to an empty session (no throw). Leave the legacy key in place (read-only).
- [x] 1.5 Implement `deriveSessionTitle(messages, documentName)`: first user message truncated to ~60 chars, else the focus document name (or "Whole Library"), else placeholder `"New chat"`. Implement `isPlaceholderTitle(title)`; `updateSession`/`saveSessions` re-derive only while the title is still the placeholder.
- [x] 1.6 Add unit tests (`src/components/tabs/__tests__/documentQaSessions.test.ts`) for create/update/delete/rename, active-id get/set, title derivation rules, caps enforcement, and legacy migration (valid blob → default session; malformed blob → empty session; no throw).

## 2. Wire the store into DocumentQATab

- [x] 2.1 Add `activeSessionId` state to `DocumentQATab`; add a load effect that runs `migrateLegacyState()` on first run, then hydrates `messages` (via `useDocumentQAStore.setMessages`), `selectedDocumentId`, and `webSearchEnabled` from the active session record whenever `activeSessionId` changes.
- [x] 2.2 Add a debounced save effect that writes the current `messages` (+ `selectedDocumentId`, `webSearchEnabled`) back into the active session via `updateSession(activeSessionId, {...})`. Ensure it flushes (saves synchronously) before any session switch/new/delete to avoid stale-debounce races (clear any pending debounce timer on switch).
- [x] 2.3 Neutralize the legacy single-blob writer: change `useDocumentQAStore`'s `persist` `partialize` so it no longer persists the new authoritative state (the session store owns persistence). Keep the `incrementum-document-qa` key readable for migration only; verify nothing else consumes the persisted `messages`.
- [x] 2.4 Keep `handleSendMessage`'s history replay (~line 1319) and message rendering unchanged in shape — verify they read `messages` from the active session only (no cross-session leakage) and that assistant messages/tool-call results are saved back to the active session via the debounced save.
- [x] 2.5 Verify tool-call side effects (`executeToolCalls`, card/extract creation) are unaffected — they keep writing to the learning-item DB as today and are not re-executed on resume.

## 3. New-chat action and context-window clearing

- [x] 3.1 Add a "New chat" control to the Document Q&A header (next to the existing "Clear Chat") using the `tabs.newChat` label with a `Plus`/`Lightning` icon; add a `Cmd/Ctrl+Shift+K` keyboard shortcut in the existing keydown handler.
- [x] 3.2 Implement `handleNewChat()`: flush-save the current session, then `createSession()`, set it active, hydrate to a clean slate (`setMessages([])`, reset composer `rawInput`/`mentions`/`selectedSections`/`detectedChapter`, default `selectedDocumentId`/`webSearchEnabled`), and focus the composer.
- [x] 3.3 Add a confirmation dialog shown only when the composer has non-empty unsent text (`rawInput.trim()`): choices "Start new chat" / "Cancel". Skip the dialog when the composer is empty. Sent history is always preserved into the outgoing session (never lost).
- [x] 3.4 Re-scope the existing "Clear Chat" button: clarify its tooltip/title to indicate it clears the active session's messages in place (or maps to New chat); ensure it no longer silently destroys history without the session being preserved.
- [x] 3.5 Add i18n keys for all new strings (`newChat`, `newChatShortcut`, `clearDraftTitle`, `clearDraftBody`, `startNewChat`, `cancel`) across `en`, `es`, `fr`, `de`, `ja`, `zh`.

## 4. Sessions sidebar (chat-app-native history UI)

- [x] 4.1 Add a collapsible left sidebar rail to the Document Q&A tab layout (flex row: sidebar + existing chat column); persist the collapsed/expanded state to `localStorage` (`document-qa-sidebar-collapsed-v1`); default open on wide viewports, collapsed on narrow ones.
- [x] 4.2 Sidebar header: a primary "New chat" button (reusing §3 affordance) + a collapse toggle control; clicking the toggle collapses/expands the rail.
- [x] 4.3 Sidebar body: render sessions from `loadSessions()` (most-recent first). Each row shows auto/user title, relative last-updated time (reuse `formatRelativeTime`), and focus-document label ("Whole Library" when `selectedDocumentId` is empty). Visually mark the active session.
- [x] 4.4 Row interactions: clicking a row resumes the session (§5); hover actions for **Rename** (inline edit → `renameSession`) and **Delete** (trash → confirm dialog → `deleteSession`).
- [x] 4.5 Empty-state (no sessions): icon + message explaining that sending a message or starting a new chat creates one, plus the cap note ("most recent 50 conversations are kept").
- [x] 4.6 Add i18n keys for the sidebar: `chatHistory`, `chatHistoryDesc`, `resume`, `rename`, `deleteSession`, `deleteSessionConfirm`, `activeSessionLabel`, `sidebarEmpty`, `sidebarCapNote`, `collapseSidebar`, `expandSidebar`, `wholeLibrary`.

## 5. Resume with full state

- [x] 5.1 Implement `handleResumeSession(id)`: flush-save the outgoing session, set the target active via `setActiveSessionId`, hydrate its full state (`setMessages`, `selectedDocumentId`, `webSearchEnabled`) into the store/component, reset the composer, and focus the chat column.
- [x] 5.2 Verify that after resume, a new prompt uses the resumed session's chat history as LLM context and the response is saved back to that session (covers the "follow-up prompts use resumed history" scenario).
- [x] 5.3 Verify tool-call messages from the resumed session render with their persisted success/error status and are not re-executed.

## 6. Migration safety and caps

- [x] 6.1 Enforce caps in `saveSessions`: keep at most 50 sessions (drop oldest by `updatedAt`); per-session messages capped at 50 (matches today's effective replay window).
- [x] 6.2 Verify the legacy key (`incrementum-document-qa`) is left intact on migration (read-only) so rollback within one release is possible; stop writing it after migration.
- [x] 6.3 Add a guard so a malformed or missing active-session id falls back to creating an empty session rather than rendering a blank/broken tab.

## 7. Tests and verification

- [x] 7.1 Unit tests for the session store module (§1.6) — create/update/delete/rename, active id, title derivation, migration paths, caps enforcement.
- [x] 7.2 Component test: starting a new chat clears messages/composer and preserves the prior session in the sidebar list.
- [x] 7.3 Component test: resuming a session restores messages and focus document, and a follow-up send uses that session's history.
- [x] 7.4 Component test: legacy `messages` blob is migrated into a default active session on first load; malformed blob does not crash.
- [x] 7.5 Component test: deleting the active session creates+activates an empty session and keeps the tab usable; deleting a non-active session leaves the active one unchanged.
- [ ] 7.6 Manual smoke test: open Document Q&A with an existing conversation (migration), start a new chat for a different document, send messages, resume the old conversation, rename and delete — confirm no data loss, no cross-session context leakage, and sidebar collapse persists.
