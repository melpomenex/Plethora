# Design — mobile Assistant composer

See `proposal.md` for motivation and `specs/mobile-assistant-composer/spec.md` for the behavior contract. This document records how the composer, menu, and chrome budget are built, which existing pieces are reused, and how the overlap with the in-flight `mobile-assistant-gesture-haptics` change is reconciled.

## Context

Current state (verified):

- `MobileAssistantHost` owns the sheet: pill gesture, detents, viewport adaptation, and the header row with a Chat/Commands tablist (`MobileAssistantHost.tsx:196-199`). It hosts `AssistantPanel` in `fillContainer` mode and lazily hosts `MobileAssistantCommands` for the Commands tab.
- `MobileAssistantCommands` is the searchable list of the **shared command registry** (same `buildCommandRegistry`/`matchCommands`/`executeCommand` as the keyboard palette) and is already covered by `commands.test.tsx` for that contract.
- `AssistantPanel` owns the composer (`data-assistant-composer`, line 3308) plus mobile-only chrome: the tools hint (3386), a stacked attach/send column (3437-3457), the dictation row (3460), the quick-action chips (3482-3508), and a wrapping toolbar (2771+) with New/model/scope.
- Assistant slash commands (`/help`, `/tools`, `/20rules`, `/clear`) are handled inside the send path (`AssistantPanel.tsx:1171-1260`); the hint text pointing at `/tools` is i18n key `assistant.typeToolsToSee`.
- The host measures chrome (`composer + toolbar + sheet header + 96`) and collapses the sheet to a single expanded stop when it would crowd the partial detent (`MobileAssistantHost.tsx:150-166`). Every removed row therefore buys back conversation height *and* keeps the two-stop sheet usable.
- Constraints: `DESIGN.md` rules (token floor, `md-state`, 48px coarse targets, tonal depth before shadows, One-Platform Rule: mobile patterns stay mobile; desktop and the selection `AskSheet` are untouched).
- OpenSpec constraint: `mobile-assistant-sheet` / `mobile-assistant-conversation` exist only as deltas inside the unarchived `mobile-assistant-gesture-haptics` change. A MODIFIED delta against a base that is not in `openspec/specs` is refused at archive time (verified by probe), so this change is an ADDED-only new capability and reconciles the overlap explicitly below.

## Goals / Non-Goals

**Goals:**

- One composer bar that reads as a chat input: leading add control, input field, trailing dictation/send — no permanent auxiliary rows on phones.
- One searchable add menu that is the single entry point for slash commands, registry commands, and image attachment.
- Reclaim vertical chrome so the conversation gains space at every detent; keep the partial detent usable on representative phone viewports.
- Preserve every existing capability (attachments, pinned selection, section mentions, dictation consent, scope, source attach/remove, new/share/model) and every existing test contract for registry reuse.

**Non-Goals:**

- No changes to pill/handle gestures, detent math, overlay Back coordination, or native layers; no changes to `AskSheet`; no desktop redesign; no new AI behavior; no auto-send semantics for slash commands.

## Decisions

### D1 — One bar: structure and behavior

The mobile composer becomes a single rounded row inside `data-assistant-composer`:

- Leading **+** control (48px target, `md-state`) inside the bar.
- Auto-growing textarea (1 line initial, capped with internal scroll); the field alone carries focus/keyboard.
- Trailing group: dictation control (mic ⇄ stop, driven by `useComposerDictation`); when the draft or attachments are non-empty, a send control; while a turn is in flight, send shows the existing busy state.
- Move the dictation button out of `ComposerDictationControl`'s row into the bar; keep its consent `Dialog` and error handling, and replace the status text with an `aria-live` announcement plus the control's icon/state (no permanent status row).
- Attachment entry: keep paste/drag handlers on the container and the hidden file input; drop the stacked icon button (now an item in the add menu).

*Alternatives considered:* keeping stacked controls but restyling (rejected — no space reclaimed); making the whole bar a `contentEditable` (rejected — breaks existing selection/keyboard logic and tests).

### D2 — The add menu owned by the composer

The **+** menu is rendered by `AssistantPanel` (it owns the textarea, `setInput`, the hidden file input, and the slash-command send path) and only when `mobilePresentation` is set. It renders as a bottom-anchored surface above the composer inside the sheet, with:

1. **Attach image** item → existing `fileInputRef.click()`.
2. **Slash commands** section — from a new shared, localized module (working name `assistantSlashCommands`) that becomes the single source of truth for `/help`, `/tools`, `/20rules`, `/clear` (id, inserted text, description key). Selecting one writes it into the input via `setInput` and leaves focus in the field; nothing is sent.
3. **All commands** section — the registry list currently in `MobileAssistantCommands`, refactored so the menu owns the single search field and filters both sections; availability gates, matching/aliases, and `executeCommand` dismissal semantics stay exactly as they are today.
4. No-results state when neither section matches; a short localized "type / in the input" line keeps slash discoverability after the old hint row is gone.

*Alternatives considered:* keeping the Commands tab (rejected — a whole 48px row plus a context switch for something the input should own); a full-screen sheet for the menu (rejected — loses the conversation context the menu exists to serve); duplicating a second search field per section (rejected — one field, one mental model).

Dismissal/layering: the menu registers with `overlayStack` above the sheet so Back closes the menu first and the draft/dictation state is preserved; focus returns to **+** on close; opening the menu never moves focus into the search field automatically (no forced keyboard). The menu sizes itself against the same viewport/keyboard metrics the sheet uses, so it stays above the software keyboard.

### D3 — Chrome budget: one header row

On phones the sheet chrome becomes: handle + **one** compact header row + contextual chips only when their state exists. The header row carries the active context (source title chip → attach/remove/switch actions), the compact scope selector, an overflow **⋯** (New conversation, Share, Model/provider — previously the wrapping toolbar), expand/collapse when two detents exist, and Close. `AssistantPanel`'s mobile toolbar stops rendering rows; the `data-assistant-toolbar`/`data-assistant-composer` attributes remain as stable measurement hooks and the host's chrome measurement is pointed at the single header row.

Removed from mobile only: mode tablist, source row, panel toolbar row, tools hint row, quick-action chips, dictation row, stacked attach column. Desktop keeps today's composer, hint, chips, and toolbar unchanged.

*Alternatives considered:* two-row header (rejected — the second row is exactly what the budget test counts); moving scope into the menu (rejected — scope is per-conversation state that should stay visible while chatting).

Target: on a 360×780 viewport, reclaim ≥ 120 CSS px of persistent chrome versus the current build, and keep both open detents available on the chrome-measurement heuristic. The count of permanent rows around the conversation (header row + composer bar + non-empty contextual chips) is the testable budget from the spec.

### D4 — Accessibility and i18n

- Every control in the new bar and menu keeps a 48px coarse target, `md-state`, visible focus, and name/state announcements; the dictation live region announces starting/listening/finalizing/error.
- New strings are localized in all six locales (`de`, `en`, `es`, `fr`, `ja`, `zh`) under `assistant.composer.*` keys; the hardcoded `Chat`/`Commands` labels disappear with the tablist.

### D5 — Reconciliation ledger (overlapping changes)

- **`mobile-assistant-gesture-haptics`** (unarchived; tasks 14/52 checked). Its proposal clarification and `specs/mobile-assistant-conversation/spec.md:90` ("Searchable command access alongside conversation") describe a *Commands mode* tab. This change supersedes the tab presentation while retaining the behavioral contract (searchable, shared registry/matcher/availability/executor, dismiss on execute, chat preserved, no forced keyboard, keyboard palette intact). Action: update that change's delta wording to the composer-anchored menu and annotate its completed tasks 12.1/12.2 as superseded (do not falsify evidence). If that change archives first, its requirement lands in `mobile-assistant-conversation` and this change converts its note into a MODIFIED delta for that spec instead (implementation-time check task). **Done 2026-10-16:** its spec delta, proposal clarification and section 12 now point at the composer add menu; the base spec is still absent from `openspec/specs`, so this change stays ADDED-only.
- **`mobile-ask-sheet`** (archived + dictation delta in the change above): untouched; the shared dictation adapter keeps the same semantics inside the inline control.
- **`command-registry` / `command-palette-navigation`** (archived): reuse only, no requirement change.
- **Desktop Assistant specs**: untouched; the change is scoped by `mobilePresentation`.

## Risks / Trade-offs

- [Losing the `/tools` hint hurts discoverability] → the menu's slash section is the discoverability surface, plus a localized hint line inside the menu; acceptance walkthrough includes a first-time user finding a slash command.
- [Single-row header overflows on 320px or 200% text] → overflow **⋯** carries secondary actions; test matrix at 320/360/390px and enlarged text.
- [Dictation status text removal degrades assistive feedback] → live-region announcements + icon/state on the control; covered by a dedicated test.
- [Menu/keyboard layering regressions] → reuse sheet viewport metrics and `overlayStack`; test with the software keyboard open and with Back.
- [Refactoring `MobileAssistantCommands` breaks its guarded contract] → keep its registry/matcher/executor tests and only lift the search field; run the existing suites unchanged where possible.
- [Moving model selection into the header overflow hides a frequently used control] → keep the model pill visible when width allows and fall back to overflow on narrow widths; verified in the width matrix.
- [Concurrent archive of `mobile-assistant-gesture-haptics` changes the delta target] → recorded D5 branch and a task to re-check base-spec availability before archiving; ADDED-only keeps this change archive-valid today.

## Migration Plan

No data migration: drafts, conversations, scopes, and dictation consent keep their existing storage paths. Ship as a normal frontend change; rollback is a revert of the commit (no schema or persisted-format changes). Desktop and PWA behavior verify as regression gates.

## Open Questions

- Should an upward swipe on **+** open the menu as well? Deferrable ergonomics addition; it does not change the specs or the task breakdown and can ship later if wanted.
- Should the quick-action chips return as an optional desktop-style row for tablets? Tablet presentation follows `mobilePresentation` today; deferring keeps the phone budget clean.
