## Why

Document Q&A (`src/components/tabs/DocumentQATab.tsx`) keeps a single, ever-growing conversation persisted in one Zustand blob (`incrementum-document-qa` → `messages`) and a single fixed "focus document" selection. When a user finishes asking questions about one document and moves to another, the previous conversation is still replayed into the LLM context window on every send (last ~6 messages), the focus document carries over, and the only "fresh start" is to **Clear Chat** — which irreversibly discards the entire prior conversation. There is no concept of a *session*, no way to set one conversation aside and start a clean one for a new document/topic, and no way to find and resume a past conversation. Users need to start a clean Q&A for a new document/topic **in a good-UX way** while preserving a history of past conversations they can return to.

## What Changes

- Introduce a **Document Q&A session** as a first-class, persistent unit that groups the chat (`messages`), the selected focus document, and the web-search toggle together — mirroring the model already shipped for AI Flashcard Studio (`add-flashcard-studio-sessions`).
- Add a **sessions sidebar** (a chat-app-native, collapsible left rail — the shape users expect from ChatGPT/Claude-style interfaces) that lists past conversations with an auto-generated title (derived from the first user prompt or the focus document), a relative timestamp, and the focus document. This is the "good UX" surface for browsing and resuming history.
- Add a **"New chat"** action (sidebar header button + header button + `Cmd/Ctrl+Shift+K` shortcut) that starts a fresh session with an empty context window, clearing the live chat and focus so generation is no longer contaminated by a prior document's turns. The previous conversation is preserved as a resumable past session and is **never** silently lost.
- Allow **resuming** a past session with a single click: loading its messages and focus document back into the live chat so follow-up prompts use that conversation's history as LLM context.
- Auto-save the active session on every change (debounced, reusing the existing `localStorage` persistence layer) and auto-title sessions from their first prompt or focus document; allow inline rename.
- Allow **deleting** a session (with confirm) from the sidebar; already-saved learning items (cards/extracts created via tool calls) are unaffected.
- Preserve backward compatibility: the current single-blob persisted state (`incrementum-document-qa`) is migrated into a default session on first load, so no user conversation is lost.

## Capabilities

### New Capabilities

- `document-qa-sessions`: Ability to create, persist, list, switch between, and resume distinct Document Q&A conversations, each encapsulating its own chat history, focus document, and web-search toggle — so the user can start a clean conversation for a new document/topic without losing past conversations.

### Modified Capabilities

<!-- No existing spec-level requirements change. Document Q&A currently has no spec in openspec/specs/; the persisted review `flashcard-review-session` spec covers the Review tab's spaced-repetition queue, which is a different surface and is unaffected. This change establishes session management via a new spec. -->

## Impact

- **Frontend (Document Q&A)**: `src/components/tabs/DocumentQATab.tsx` — the primary change. The current single `messages` state (persisted via `useDocumentQAStore` + Zustand `persist` under `incrementum-document-qa`) and the `selectedDocumentId` / `webSearchEnabled` UI state move into a session-store abstraction (an active session id + a list of sessions). Add a collapsible sessions sidebar with a "New chat" control, session rows (resume / rename / delete), and an empty-state; rewire the existing store hydration and save path to read/write per-session.
- **Persistence**: a new `localStorage` shape for sessions (e.g. `document-qa-sessions-v1` keyed list + `document-qa-active-session-v1`), with a one-time migration of the legacy `incrementum-document-qa` `messages` blob into a single default session so existing conversations are preserved. The existing Zustand `persist` of `messages` is superseded by the session store (kept read-only for migration/rollback).
- **i18n**: new strings for session actions (new chat, sessions sidebar, resume, rename, delete session, confirm-clear, empty-state, cap note) across all locale files (`en`, `es`, `fr`, `de`, `ja`, `zh`).
- **No backend/Rust changes**; sessions are a client-side persistence concept. No breaking changes to saved learning items — sessions only govern the in-tab conversation/workspace state, not the persisted card/extract DB. Tool calls that create cards/extracts continue to write through to the learning-item DB exactly as today.
