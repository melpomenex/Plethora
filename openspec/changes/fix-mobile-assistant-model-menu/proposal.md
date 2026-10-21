## Why

On a phone, opening the Assistant's model selector draws a tall menu past the bottom of the sheet and clips the remaining providers, so the user cannot scroll to or choose them (reported with a screenshot of `Ollama`, `OpenRouter`, and a partially visible `DeepSeek` inside a half-height sheet). The menu is an absolutely positioned `w-72` panel (`.AssistantPanel.tsx:3671`) inside a panel whose root is `overflow-hidden` (`.AssistantPanel.tsx:3502`); it has no maximum height and no scroll container, while six or seven rich provider cards are taller than the visible sheet, especially at the partial detent. The same markup also uses clickable `div`s, so the choices are not keyboard- or screen-reader-operable controls.

The model/provider choice is the switch between local and cloud engines and must be reliable before a user can trust any Assistant answer. A contained, scrollable picker is a small, testable fix that removes an unreachable-control failure without changing provider routing or settings behavior.

## What Changes

- Replace the mobile model dropdown with an in-sheet model picker that occupies the sheet body below the compact header. The picker is bounded by the sheet by construction, so it cannot draw off screen or be clipped by the panel.
- Put the provider list in its own `overflow-y-auto` / `overscroll-contain` region with a visible title, a settings shortcut, and a close action. Auto-expand the sheet from the partial detent to expanded when the picker opens so the list has usable height; the user can still collapse the sheet, where the list remains scrollable.
- Render each provider as a real button with a status badge, model/capability details, at least 48 CSS-pixel touch targets on coarse pointers, and an exposed active/selected state. Selecting a configured provider applies it and closes the picker; selecting an unconfigured provider keeps the existing AI-settings handoff.
- Make Back/Escape close the picker before the Assistant sheet, move focus into the picker on open, and return focus to the model control on close. Preserve the draft, conversation, attachments, and sheet detent behavior.
- Extract the provider-card/list markup so desktop and mobile share one source, and add internal scrolling plus localized labels (title, status, active, setup hint, capability badges) instead of hardcoded English.
- Add focused interaction tests and a real-browser containment/scroll harness covering narrow phones, short viewports, long provider lists, landscape, 200% text, and the last provider being reachable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-assistant-composer`: Add requirements that the mobile model picker stays within the Assistant sheet, scrolls through every provider, exposes accessible selection controls, and dismisses/restores focus without losing the conversation or draft.

## Impact

- Primary UI: `src/components/assistant/AssistantPanel.tsx`, a new extracted model-picker component under `src/components/assistant/`, and the existing mobile presentation contract only if focus/dismissal needs a host hook.
- Localization: `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts` for the picker title, statuses, capability badges, setup hint, and close/settings actions.
- Tests: extend `src/components/assistant/__tests__/AssistantPanelMobileComposer.test.tsx` or add a focused mobile picker test; add a `src/visual` harness/spec for clipping and scroll reachability; keep `AssistantPanelProviderPersistence.test.tsx` passing for provider persistence.
- No provider routing, API-key storage, settings schema, backend, database, or dependency changes. Desktop keeps its anchored menu; only shared card semantics and bounded scrolling change.
