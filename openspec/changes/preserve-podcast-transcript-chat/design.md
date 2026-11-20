## Context

`PodcastManager` routes the episode row, player, and transcript viewer through `handleChatAboutThis`. The inline Assistant receives transcript text and a title. `AssistantPanel` derives `document:unknown` for this context and stores messages, text drafts, and scope in its shared conversation map. Browser storage is the immediate save path, with a SQLite mirror on Tauri. Reply completion currently appends to React state owned by the panel.

The in-flight `unify-assistant-experience` change defines a turn controller and repository with durable attempt identities. Their normal `AssistantPanel` integration is pending. `stream-llm-responses` covers transport and rendering of partial responses. This change uses the same attempt ownership model for the podcast entry point and works with the existing buffered reply path.

## Goals / Non-Goals

The persistence boundary is the existing Assistant storage for the local profile. The lifecycle change covers ordinary replies sent from the inline podcast transcript Assistant. Learning Agent execution, the global Assistant, chat sync, and transcript management use their current workflows.

## Decisions

### Use the podcast episode row ID for stable identity

Build a namespaced key such as `podcast:episode:<id>` from the persisted `PodcastEpisode.id` at the shared open path. Pass it through the existing `conversationKey` and `conversationId` interfaces. Keep an attached transcript context and use the same episode identity for context ownership where needed. `documentId` identifies a persisted library document and triggers document lookup and authorization. The episode ID can be used before any library document exists. Titles and transcript text can change during the lifetime of an episode.

Tie each async transcript load to the opening intent. Apply it only if that intent still owns the visible host so a slow response from a previous episode cannot reopen or replace the current chat. Restore the episode's saved state before accepting input or writing a default record. Reuse the existing scroll hook with the conversation ID.

### Commit chat turns independently of the panel

Use a conversation-scoped owner above the podcast panel and route lifetime. Keep one active ordinary reply per episode thread and associate it with an attempt ID and the originating profile. The panel subscribes while visible and reads the latest snapshot on remount. The owner records the submitted message and pending attempt before dispatch, then commits the terminal outcome once even if the view has detached. This keeps global listeners and rendering tied to the visible panel. The canonical `TurnController` is the integration point when available to the surface, with the same ownership and terminal-state rules on the current Assistant storage path. Each session has one writer.

Capture the transcript, scope, history, and provider inputs when the user submits. Use the existing prompt, permission, and response handling for both visible and detached replies. Persist attempt status and the user turn reference alongside existing message and draft state. Keep live request resources and the full transcript used to build the prompt in memory. Hydrate a saved pending attempt as interrupted only when its live owner is absent. Explicit retry reuses the user turn with a new attempt and revalidates the episode context. Reuse existing status, stop, and retry affordances where applicable.

Stop and clear invalidate the attempt before updating stored state. Guard completion, progress and view effects against stale attempt identities. Keep viewer-dependent actions and confirmations tied to the originating view and preserve existing tool permission checks. Restoring stored tool results renders their recorded outcome.

## Risks / Trade-offs

- A SQLite hydration result or old panel save can arrive after a newer draft, answer, or clear. Serialize updates for the same episode, merge complete snapshots by the existing freshness mechanism, and test that stale or empty hydration cannot overwrite a newer state or restore cleared messages.
- Two opens of the same episode can overlap with a reply or transcript load. Bind both views to the same session owner, guard delayed opens, and update only the matching turn on completion. Release request resources on every terminal path.
- A profile change or explicit reset can race with a reply. Invalidate the old attempt at that boundary and check ownership before persisting the result or delivering view effects.

## Migration Plan

Start using the episode namespace on first open. Preserve `document:unknown` in place because its records have no reliable episode association. New records use the existing Assistant store and are readable on subsequent opens under the same key. Rolling back leaves those records available for a later version that recognizes the namespace.
