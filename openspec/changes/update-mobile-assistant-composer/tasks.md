## 1. Shared command model and strings

- [x] 1.1 Add a shared assistant slash-command module (working name `assistantSlashCommands`) that lists `/help`, `/tools`, `/20rules`, `/clear` with inserted text and description keys, and refactor the desktop quick-action chips and the mobile menu to consume it. Verify a unit test covers the exact command set and that no other hardcoded list remains (`grep` shows one definition).
- [x] 1.2 Add `assistant.composer.*` i18n keys (menu title, search placeholder, attach image, slash-commands section, all-commands section, no results, slash hint, new conversation, share, model) to `en` and the five other locales. Verify `src/lib/i18n/__tests__/i18n-completeness.test.ts` passes with no missing keys.

## 2. Single-surface composer bar

- [x] 2.1 Refactor `ComposerDictationControl` so its microphone/stop button can render inside the composer bar while keeping the consent `Dialog` and error handling; replace the permanent status text with an `aria-live` announcement and icon/state on the control. Verify the existing dictation tests pass and a new test asserts the status is announced without rendering a status row.
- [x] 2.2 Rebuild the mobile composer DOM in `AssistantPanel` (`mobilePresentation` only) as one bar: leading **+** control, auto-growing single-line textarea, trailing dictation and conditional send/busy control; keep `data-assistant-composer`/`data-assistant-composer-input` hooks and the drag-over/paste behavior. Verify a component test renders exactly one composer row with no hint row, quick-action chips, stacked attach column, or dictation row when `mobilePresentation` is set.
- [x] 2.3 Keep image attachment working through the menu entry (picker) plus existing paste/drag handlers, with the attached-image strip still shown above the bar when images exist. Verify the attachment suite passes with the attach button now opened from the **+** menu.

## 3. Add menu (slash commands, registry commands, attachment)

- [x] 3.1 Refactor `MobileAssistantCommands` so the menu owns one search field and the component becomes the filtered registry list (query prop, execute callback) while keeping `buildCommandRegistry`/`matchCommands`/`executeCommand`, availability gates, aliases, and the no-results state. Verify the existing `commands.test.tsx` contract is preserved (search/execute/no-results adapted, registry reuse assertions unchanged).
- [x] 3.2 Build the mobile menu container rendered by `AssistantPanel`: attachment item, slash-commands section, all-commands section, slash hint line, anchored above the composer with viewport/keyboard-aware max height; opening does not move focus into search. Verify a menu test covers open/close, slash selection inserting `/tools` without sending, and the menu staying above the keyboard.
- [x] 3.3 Wire selection semantics and dismissal: slash selections write into the draft via `setInput`; registry selections execute through the shared executor, dismiss the menu, and preserve conversation/draft/scope; the menu registers in `overlayStack` above the sheet so Back closes it first; focus returns to **+**. Verify tests for each behavior, including Back ordering and draft preservation.

## 4. Conversation-first sheet chrome

- [x] 4.1 Remove the Chat/Commands tablist and mode state from `MobileAssistantHost`; make the header a single compact row (context/source chip with attach/remove/switch actions, compact scope selector, overflow **⋯** for New conversation/Share/Model/expand-collapse as needed, Close) and delete the separate source row. Verify host tests assert one header row and that source attach/remove, scope, close, and expand/collapse remain operable.
- [x] 4.2 Collapse `AssistantPanel`'s mobile toolbar so it no longer renders a wrapping row on phones (its actions live in the header overflow or menu), while keeping the `data-assistant-toolbar` measurement hook and pointing the host chrome measurement at the single header row. Verify the host chrome-measurement test and the model/scope reachability tests pass.
- [x] 4.3 Remove the mobile tools hint row and quick-action chips (desktop unchanged) and drop the hardcoded `Chat`/`Commands` labels. Verify a regression test renders the desktop composer with hint/chips intact and the mobile composer without them, and `grep` finds no hardcoded `"Chat"`/`"Commands"` labels in the mobile sheet.
- [x] 4.4 Prove the chrome budget: on a 360×780 viewport the permanent rows around the conversation are at most the header row plus the composer bar (plus non-empty contextual chips), and the partial detent remains available instead of collapsing to a single stop. Verify with a DOM row-count test and the host detent test; record the measured reclaim (target ≥ 120 CSS px).

## 5. Reconciliation and cleanup

- [x] 5.1 Reconcile `openspec/changes/mobile-assistant-gesture-haptics`: update its `specs/mobile-assistant-conversation` wording from the Commands mode/tab to the composer-anchored searchable menu, and annotate completed tasks 12.1/12.2 as superseded without falsifying evidence. Verify the edited change still validates (`openspec validate mobile-assistant-gesture-haptics`) and note the supersession in this change's design ledger.
- [x] 5.2 Before archiving, re-check whether `mobile-assistant-conversation` now exists in `openspec/specs` (i.e. the other change archived first); if it does, convert this change's reconciliation note into a MODIFIED delta for that spec. Verify `openspec validate update-mobile-assistant-composer --strict` still passes in whichever branch applies.
- [x] 5.3 Remove dead code and strings from the replaced composer/mode (unused imports of the old Commands lazy path, obsolete CSS classes) and confirm `npm run lint` reports no unused-symbol or token-floor violations for the touched files.

## 6. Verification

- [x] 6.1 Run the focused suites (`AssistantPanel*`, `mobile/__tests__/*`, `i18n-completeness`), `npx tsc --noEmit`, and `npm run test:run`; record exact commands and distinguish preexisting failures.
- [x] 6.2 Run mobile/browser acceptance with evidence: 320/360/390px widths, 200% text, reduced motion, keyboard open while opening the menu, Back ordering (menu → sheet → view), dictation consent/deny/error, image picker, pinned-selection and section chips, and a first-time discoverability walkthrough for slash commands; record artifacts in `validation.md`.
- [x] 6.3 Run `npm run bench:check` (including bundle budgets); if composer render cost changes intentionally, add/update a seeded benchmark and baseline per the repo perf protocol, otherwise record that no baseline change was needed.
- [x] 6.4 Re-run `openspec validate update-mobile-assistant-composer --strict` and confirm every scenario in `specs/mobile-assistant-composer/spec.md` maps to a test or recorded acceptance row.
