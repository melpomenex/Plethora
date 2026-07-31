## Why

The AI Flashcard Studio keeps a single, ever-growing conversation (`messages`) that is replayed into the LLM context window on every send (the last ~10 turns) and a single shared pile of `draftCards`. When a user finishes generating cards from one document or section and moves on to another, the previous document's chat and drafts are still live: the model keeps referencing the old context, the draft list mixes cards from unrelated sources, and the only "fresh start" path today is to manually clear the chat and delete drafts. There is no concept of a *session* — a bounded unit of "cards I'm creating from this document/section right now" — and no way to set a session aside and come back to it later. The existing "History" view is only a flat log of one-line prompts; it does not restore the conversation, drafts, or context that produced those cards. Users need to start a clean session for a new document/section while preserving the ability to find and resume past work.

## What Changes

- Introduce a **Flashcard Studio session** as a first-class, persistent unit that groups the chat (`messages`), the `draftCards`, the selected document/deck/provider, and the `contextSelection` together.
- Add a **"New session"** action that clears the live context window (chat + drafts + section/chapter focus) and starts a fresh session, so generation is no longer contaminated by a prior document's turns. Unsaved drafts are preserved into the new session's draft list only if the user chooses; the default is a clean slate.
- Add a **Sessions** view (replacing/expanding the current flat History view) that lists past sessions with an auto-generated title (derived from the first user prompt or selected document), timestamp, card/draft counts, and the source document, so users can find what they were working on.
- Allow **resuming** a past session: loading its messages, drafts, document, deck, and context selection back into the Studio so the user picks up exactly where they left off — including restoring it as the live LLM context for follow-up turns.
- Auto-save the active session on every change (debounced, reusing the existing `localStorage` persistence layer) and auto-title sessions from their first prompt or document.
- Preserve backward compatibility: the current single-blob persisted state (`flashcard-studio-state-v3`) is migrated into a default session on first load, so no user data is lost.

## Capabilities

### New Capabilities

- `flashcard-studio-sessions`: Ability to create, persist, list, switch between, and resume distinct AI Flashcard Studio sessions, each encapsulating its own chat history, draft cards, document/deck/provider selection, and context focus — so the user can start a clean context window for a new document/section without losing past work.

### Modified Capabilities

<!-- No existing spec-level requirements change. The Flashcard Studio currently has no spec; the existing `flashcard-review-session` spec covers the Review tab's spaced-repetition queue, which is a different surface and is unaffected. This change establishes session management via a new spec. -->

## Impact

- **Frontend (Flashcard Studio)**: `src/components/review/FlashcardStudioModal.tsx` — the largest change. The current single `messages` / `draftCards` / `contextSelection` state and the `flashcard-studio-state-v3` / `flashcard-studio-history` `localStorage` blobs move into a session-store abstraction (an active session id + a list of sessions). Add a "New session" control and a Sessions list view; rewire the existing save/restore `useEffect`s to read/write per-session.
- **Persistence**: new `localStorage` shape for sessions (e.g. `flashcard-studio-sessions-v1` keyed list + `flashcard-studio-active-session-v1`), with a one-time migration of the legacy `flashcard-studio-state-v3` blob into a single default session so existing chats/drafts are preserved.
- **i18n**: new strings for session actions (new session, resume, session list, empty-state, rename, delete session, confirm-discard) across all locale files (`en`, `es`, `fr`, `de`, `ja`, `zh`).
- **No backend/Rust changes**; sessions are a client-side persistence concept. No breaking changes to saved learning items — sessions only govern the in-Studio drafting/workspace state, not the persisted card DB.
