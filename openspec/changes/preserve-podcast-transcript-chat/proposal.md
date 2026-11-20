## Why

Listeners should be able to leave the Assistant while discussing a podcast transcript and pick up where they left off. The podcast panel currently uses a generic conversation key shared by episodes, and closing the panel unmounts the view that owns the active reply.

## What Changes

- Reopen the same episode's conversation from **Chat About This** in the episode list, player, or transcript viewer. Restore the saved messages, unsent text, and selected answer scope after dismissal, navigation, or an app reload.
- Keep conversations isolated by episode so another episode's messages and drafts never appear in the current panel or enter its follow-up prompts.
- Let an already-submitted chat reply finish in its original conversation while the app is running. Show its pending or final state on return and preserve an interrupted question for explicit recovery if the app stops.
- Keep explicit Stop and Clear Chat actions effective for the current conversation. Preserve legacy shared history without automatically assigning it to any episode.

## Capabilities

### New Capabilities

### Modified Capabilities

- `assistant-conversation-scopes` gains episode-specific history, draft restoration, and reply continuity for podcast transcript chat.

## Impact

- Podcast Manager transcript-chat entry points and the shared Assistant panel on desktop and mobile layouts where the feature is available.
- Assistant conversation persistence, request ownership, and transcript grounding. The change uses existing provider and storage paths and requires no transcript schema change.
