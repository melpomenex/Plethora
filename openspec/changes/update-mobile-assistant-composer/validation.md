# Validation — update-mobile-assistant-composer

Evidence recorded 2026-10-16 on the working tree at `bd917dd8` (uncommitted change). Chrome budget and browser acceptance were measured against the running dev server (`http://localhost:15173`); the before column came from a throwaway worktree at `HEAD` served on port 15174 (removed afterwards).

## Automated evidence

| Command | Result |
| --- | --- |
| `npx vitest run src/components/assistant src/components/mobile` | 31 files, 199 tests passed |
| `npx vitest run src/lib/i18n/__tests__/i18n-completeness.test.ts` | 17 tests passed (all new keys resolve; placeholder parity intact) |
| `npx tsc --noEmit` | clean |
| `npx eslint <touched files>` | 0 errors (CSS file intentionally ignored by the eslint config) |
| `npm run test:run` | 867/875 files passed, 7162/7173 tests passed; the 10 failures are pre-existing and reproduced on a pre-change worktree (`ocrCommands`, `Toolbar`, `useShareTargetDedupe` ×2, `iosCapabilitiesDoc`, `audioEditionIntegration`, `ReviewQueueView`; `ReviewCard` passed twice in isolation and failed only under full-suite load). The 3 unhandled errors come from `src/hooks/useShareTarget.ts` mocks, also pre-existing. |
| `npm run bench:check` | OK — 57 benchmarks compared; bundle budgets OK (entry 3 KB, total 24.5 MB). No baseline changes needed: no composer render path is benchmarked and the menu no longer builds the command registry while closed. A first run failed only `ambient/scheduler-decision` under full-suite load; isolated reruns and the quiet-machine rerun pass. |
| `openspec validate update-mobile-assistant-composer --strict` | valid |
| `openspec validate mobile-assistant-gesture-haptics` | valid (after the reconciliation wording change) |

Focused suites added or updated:

- `src/components/assistant/__tests__/assistantSlashCommands.test.ts` — exact slash-command set, description keys resolve in `en`, matching.
- `src/components/assistant/__tests__/ComposerDictationControl.test.tsx` — status is announced through a hidden live region with no status row; consent dialog wiring preserved.
- `src/components/assistant/__tests__/AssistantPanelMobileComposer.test.tsx` — one composer bar (no hint/chips/stacked attach/dictation row/tabs), menu open without focus stealing, slash insert without send, filtering + no-results, registry execution + dismissal, New/Share reachability, Back closes the menu before the sheet, attach opens the picker, transient dictation error, desktop regression.
- `src/components/assistant/mobile/__tests__/host.test.tsx` — no tablist/source bar, one handle-only header row, sheet controls handed to the panel, reduced chrome keeps two detents, oversized chrome still collapses to one stop.
- `src/components/assistant/mobile/__tests__/commands.test.tsx` — registry/theme/source-title wiring, shared matcher aliases, shared executor, empty-filter rendering.

## Chrome budget (360 × 780, partial stop, same 351 px sheet)

| Measure | Before | After |
| --- | --- | --- |
| Sheet header (handle + tabs row) | 92 px | 44 px |
| Panel toolbar row | 59 px | 53 px |
| Composer block | 261 px | 95 px |
| **Persistent chrome total** | **412 px** | **192 px** (`−220 px`, target ≥ 120) |
| Message area inside the partial stop | 24 px | 159 px (`+135 px`, 6.6×) |
| Chat/Commands tabs | present | removed |

## Browser acceptance (Playwright + Chromium, local dev server)

- **360×780 and 390×780**: pill visible; sheet opens at the partial stop (351 px) with both open stops available (expand/collapse control present, `hasPartial` true in `mobilePresentation.sheet`); single toolbar row without horizontal overflow; composer column renders exactly the bar + hidden file input.
- **320×780**: pill visible; same partial-stop behaviour; no toolbar overflow; menu stays inside the sheet.
- **200% text (360×780)**: toolbar stays one row (61 px) without overflow; close and add controls visible; menu stays inside the sheet.
- **Reduced motion**: sheet opens at the partial stop.
- **Menu**: in flow between conversation and composer (never clipped, `menuInsideComposer: false`); search field visible and **not** focused on open; dismissed by the attachment row and by Escape; slash rows, all-commands section and the slash hint render.
- Screenshots: `.test-artifacts/composer-acceptance/320x780-menu.png`, `360x780.png`, `360x780-menu.png`, `360x780-text200-menu.png`, `390x780.png` (`prechange-360x780.png` kept for the before comparison).

## Outstanding device rows (release acceptance, not claimable here)

- Soft-keyboard resize while the menu is open (no IME in Chromium desktop): the menu is in flow inside the sheet and inherits the sheet's keyboard-driven height, verified structurally and by the menu-inside-sheet checks only.
- Android predictive Back ordering (menu → sheet → view): ordering is enforced by `overlayStack` priority 70 > 60 and covered by unit tests; physical Back not exercised.
- iOS Safari and TalkBack/VoiceOver walkthroughs; real-microphone dictation consent/deny/error flows.
- Slash-command discoverability walkthrough with a first-time user.

## Scenario coverage map (spec → evidence)

| Spec scenario | Evidence |
| --- | --- |
| Empty draft shows add + dictation, no auxiliary rows | `AssistantPanelMobileComposer` row-count test; browser screenshot |
| Draft non-empty shows send | composer test (send appears with text); desktop regression |
| Dictation status not a row | `ComposerDictationControl` test; `AssistantPanelMobileComposer` transient-error test |
| Slash command composed, not auto-sent | `AssistantPanelMobileComposer` insert test |
| Registry action matches keyboard palette | `commands.test` executor test; menu dismissal test |
| Availability and empty results | `commands.test` empty-filter; menu no-results test |
| Attachment from the same menu | picker test; browser `menuDismissedByAttach` |
| Contextual chips only with state | row-count test (2 permanent rows with no state) |
| Chrome no longer forces a single detent | host budget test; before/after browser table |
| New conversation reachable | menu test; scope-persistence test |
| Assistive walkthrough / large text / reduced motion | live-region + target-size assertions; browser 200% + reduced-motion rows (SR walkthrough outstanding) |
| Dictation consent/deny/error | existing dictation suite + transient-error test (device rows outstanding) |
| Desktop unchanged | desktop regression test |
| Selection Ask unchanged | `AskSheet.test` suite passed unchanged |
| Localized chrome | `i18n-completeness`; menu strings rendered via `t()` |
