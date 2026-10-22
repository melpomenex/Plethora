## Why

The Assistant header places `Chat / Document / Library` beside `Chat / Learning Agent`, making two independent choices look like competing navigation and repeating “Chat.” Readers should be able to choose how to work and understand which sources will inform the answer without decoding internal scope terminology.

## What Changes

- Keep one primary `Chat / Learning Agent` mode switch in the Assistant header. Selecting a mode prepares the composer; it never sends a request.
- Move Chat source selection into a secondary, always-visible `Answer from` control beside the composer: `General knowledge`, `This document only`, and `My library`. Explain that General knowledge can also use attached context; preserve all existing grounding and retrieval policies.
- Show Learning Agent's existing explicit sources and attachments in agent mode, replacing the Chat source control so it cannot imply a restriction the agent does not use.
- Preserve the draft, thread, learning artifacts, existing scope identifiers, entry-point defaults, provider picker, agent readiness feedback, and approval boundaries.
- Use the same source terminology in the shared selector's selection-sheet and Document Q&A consumers. Keep desktop and mobile behavior consistent, with bounded menus, keyboard access, localized copy, and visible selected states.
- Deliver this as a focused presentation fix coordinated with `unify-assistant-experience`; its conversation repository, sync, and routing overhaul are outside this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-conversation-scopes`: Present the three preserved source policies as secondary `Answer from` choices, reserve Chat for the primary execution mode, and specify source visibility and continuity when switching between Chat and Learning Agent.

## Impact

- Frontend: `src/components/assistant/AssistantPanel.tsx`, `AssistantScopeSelector.tsx`, its `AskSheet.tsx` and `src/components/tabs/DocumentQATab.tsx` consumers, relevant tests and visual fixtures, and `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts`.
- Internal `AssistantScope` values (`chat`, `document`, `library`), model routing, agent adapter, and stored message/session formats remain compatible; no native/backend or database migration is required.
- Coordinate the overlapping first requirement in `unify-assistant-experience/specs/assistant-conversation-scopes/spec.md` before either change is archived. That broader change must retain this clarified mode/source hierarchy when it lands.
- Validation will cover independent mode/source transitions, strict grounding, palette handoffs, unavailable-agent recovery, draft retention, desktop sidebar widths, mobile sheet focus/Back behavior, localization, and the repository performance gate.
