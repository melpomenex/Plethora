## 1. Establish integration contracts and regression baseline

- [x] 1.1 Recheck `design.md` evidence/overlap ledger against current source and active changes, especially shared Assistant, native haptic/Back repairs, PDF context, scroll toggle and concurrent palette work; update only this change's ledger with revisions and dependency disposition. Verify `openspec validate mobile-assistant-gesture-haptics --strict` and leave unrelated changes intact.
- [x] 1.2 Record current focused Back/overlay/Ask/Assistant/context/haptic test results in `validation.md`, including failures reproduced before feature work. Verify wrapper still disables JS edge Back on native Android and retains original fallback thresholds/exclusions; no new baseline is presented as physical acceptance.
- [x] 1.3 Define small proposed gesture/geometry types, mobile host/context registration contract, three typed Assistant feedback events, optional Panel mobile/session-key contract and purpose-scoped speech wire fixtures as described in design. Verify TypeScript/native contract fixtures distinguish existing APIs from new additions and no dependency or deployment-floor change is required.

## 2. Reuse the existing conversation surface and stable mobile session

Depends on section 1. Acceptance: a single existing AssistantPanel runs the mobile conversation; old desktop/per-source and selection records remain compatible.

- [x] 2.1 Add optional `conversationKey` and mobile-host presentation boundaries to `AssistantPanel`, preserving all default desktop behavior and `fillContainer`. Verify existing Panel/provider tests plus new tests prove `mobile:global` rehydrates only when session identity changes, not when current document/title/playback changes.
- [x] 2.2 Preserve global messages, draft, scope, summary/request epoch and pending status across hidden presentation; add explicit New conversation that affects only this key. Verify reopen, remount, storage corruption/quota failure, explicit reset and late-result rejection with fake providers; no selection or desktop key is overwritten.
- [ ] 2.3 Add optional per-message source/privacy provenance with backward-compatible parsing, maintain 200-message storage bound, and exclude raw excerpts/audio/native IDs and the new mobile-only key from automatic cross-device publication/hydration. Verify old record fixtures restore unchanged and existing desktop sync behavior is preserved.
- [ ] 2.4 Apply current and historical source privacy checks before request/history/summary transmission through the existing gate; resolve extract parent IDs and avoid invalid RSS DB lookups. Verify local-only→cloud, newly excluded/deleted/unknown source and general/no-document cases; rejected requests retain visible history and offer local-provider/new-conversation recovery.
- [ ] 2.5 Freeze context/history/provider/session epoch at submit; keep a response attributed to its frozen turn during active-view changes and allow hidden-session completion without reopening. Verify fake async resolution, clear/reset, source switch and background abort behavior cannot append to another session or navigate the reader.

## 3. Publish active-view context and reconcile entry points

Depends on section 2. Acceptance: current view context is visible, source-accurate and optional; no second AI or transcript pipeline is introduced.

- [ ] 3.1 Add mobile context/availability provider with active tab/pane ownership, revision/token cleanup, safe general fallback and sticky context removal per source revision. Verify inactive/late registrations and removed-source playback updates cannot replace or reattach context.
- [ ] 3.2 Register existing `DocumentViewerWrapper` context/resolver before embedded early returns; reuse PDF selection/page/OCR fallback and EPUB section context without changes to gesture/scroll ownership. Verify PDF, EPUB and missing-text fixtures use the existing per-prompt resolver and preserve reading position.
- [ ] 3.3 Register Queue's authoritative current-item context (PDF/EPUB/extract/RSS/live video); suppress embedded child registration while Queue owns source. Verify item changes clear stale context, extracts use parent provenance, and video current-time/partial/unavailable/retry states match existing canonical transcript logic.
- [ ] 3.4 Register standalone RSS current-article context and safe general view labels for library/dashboard/settings; integrate review, selection and reader-control availability without content-wide pointer listeners. Verify context never comes from inactive panes, hidden documents or credential fields.
- [ ] 3.5 Route mobile general reader/PWA/Queue Assistant actions to the single host, preserving selection feature flags and desktop entry behavior. Verify DOM/integration tests show one floating trigger and one global conversation host across eligible routes; absent AI setup opens actionable configuration guidance.

## 4. Implement local gesture recognition independently of rendering

Depends on section 1 contracts; integrate host after section 5. Acceptance: no outside-origin gesture opens Assistant and no Assistant gesture emits navigation.

- [x] 4.1 Implement pure invocation reducer/geometry with 8px slop, 1.25 upward ratio, 16px ambiguous rejection, frozen `clamp(0.12H,64,96)` threshold, current-displacement release and independent threshold latch. Verify table-driven boundary tests for T−1/T/T+1, negative/horizontal travel, reversal/re-cross and no velocity bypass.
- [x] 4.2 Implement pill Pointer Events binding/capture with local `touch-action`, opaque gesture identity, compatibility-click suppression and no global document/iframe recognition. Verify below-slop tap, rejected drag, secondary pointer/mouse, outside-origin crossing pill, cancellation before/after capture and StrictMode remount tests.
- [x] 4.3 Implement terminal cleanup on pointercancel, capture loss, second contact, blur/background, active-view change, geometry change, owner hiding and unmount. Verify each terminal input rejects later pointerup/click/callback commits and returns to the preceding stable state.
- [x] 4.4 Implement handle-only detent reducer using `min(80px,0.15H)` travel, one-state-per-release rules, no-fling bypass and overscroll resistance. Verify partial↔expanded, partial→closed, single-detent dismissal, unchanged release and history/composer-origin movements.

## 5. Build the global host, animation and viewport behavior

Depends on sections 2–4. Acceptance: the sheet tracks the finger, preserves the reader and remains usable with keyboard, fullscreen controls, landscape and accessibility settings.

- [ ] 5.1 Mount one `MobileAssistantHost` in MobileLayoutWrapper's existing mobile branch; add central 120×48px minimum pill with 8px nav gap from measured nav bounds, 32px lateral edge separation and pointer-transparent surrounding layer. Verify native-phone landscape, narrow browser/PWA, absent-nav and desktop/wide-tablet presentation fixtures with localized/large text.
- [ ] 5.2 Implement resistant invocation preview, adaptive partial/expanded heights and single-stop fallback, with lazy conversation mount only on accepted open. Verify preview neither focuses nor resolves context/AI/microphone, and cancel causes no reader remount/scroll mutation.
- [x] 5.3 Render transform/opacity through refs and a coalesced rAF path; add bounded spring settlement/interruption and epoch-guarded completion with immediate reduced-motion/E-Ink release. Verify interruption resumes from sampled position, stale completion cannot reopen, and movement does not rerender Panel or run source extraction.
- [ ] 5.4 Reuse published visual-viewport/safe-area variables for portal placement and keyboard expansion/restoration; cancel drag on geometry changes and avoid double keyboard padding. Verify keyboard focus/dismissal, offset viewport, rotation, pinch/resize and large-text fixtures keep composer and close reachable without haptic detent events.
- [ ] 5.5 Add a single priority-60 global overlay owner, raw preview registration replaced by committed dialog focus registration, retained through exit; preserve existing Back coordinator/bridge and default priority-100 dialog behavior. Verify Back during preview/open/exit, repeated Back, nested menu/modal, IME precedence and focus/body-lock cleanup; no new Back listener or recognizer appears.
- [ ] 5.6 Match incumbent tonal tokens/radius/typography, pill z-index 1001 and sheet 1040 below higher dialogs; provide scrim guard, Close/Expand/Collapse controls, inert background, accessible naming/state and focus restoration. Verify opening click cannot instantly dismiss, duplicate focus/overlay owners are absent, and existing sheets remain above the host.
- [ ] 5.7 Integrate reader-controls/fullscreen/review/selection/unrelated-keyboard availability. For unsupported fullscreen hosting, use explicit existing-toolbar exit-and-open; verify reader position, auto-hidden controls, native fullscreen media, selection handles, grading joystick and existing docked cards retain ownership.

## 6. Integrate semantic haptic events

Depends on sections 4–5. Acceptance: one threshold attempt per qualifying drag, no double opening buzz, bounded shared hardware delivery.

- [x] 6.1 Register `assistant.invoke-armed`→threshold/250ms/10, `assistant.opened`→activation/250ms/10 and `assistant.detent-settled`→selection/120ms/0 using existing interaction-only policy. Verify typed event coverage, no sound/toast/OS channels, settings migration unchanged and existing native effect wire fixtures unchanged.
- [x] 6.2 Emit threshold only at reducer's first recognized crossing with `${gestureId}:armed`, latching before admission; emit tap-open only after accepted transition and changed nonclosed detent only at user settle. Verify dozens of movement frames, retreat/re-cross, suppression/retry, initial-open settle and duplicate callbacks produce the exact attempt sequence in `validation.md`.
- [ ] 6.3 Exercise actual orchestrator/service admission with fake time/driver for cooldowns, duplicate phase IDs, mixed existing events, busy slot, readiness, app/sound settings, background/configuration revision and unsupported hardware. Verify no replay, no animation wait and no driver bypass; preserve existing global/native limits and 150ms native TTL.
- [ ] 6.4 Confirm Back dismissal uses only existing navigation-completion feedback and cancelled gestures/close/passive layout changes add no Assistant cue. Verify regression tests, privacy-safe diagnostic IDs and absence of new vibration calls outside the browser driver.

## 7. Add short Android native dictation in the existing plugin

Depends on section 1 speech contract; composer wiring follows section 9. Acceptance: native app mic performs bounded editable dictation without changing ML Kit file/lecture behavior or silently uploading audio.

- [ ] 7.1 Add `dictation_status`, `start_dictation`, `stop_dictation`, `cancel_dictation` Rust/Kotlin commands, generated permission entries and scoped capability wiring to `plethora-android-speech`; keep existing three commands and file-provider preferences intact. Verify Rust/TS bridge fixtures and Android compile/permission tests, including non-Android unavailable behavior.
- [ ] 7.2 Add side-effect-free service/on-device/locale/permission capability detection, API guards, required RecognitionService visibility query, explicit runtime mic request and main-thread RecognitionListener lifecycle. Verify fake Android tests for no service, API below 31, on-device available, missing locale/model, denial and service error; no capture/prompt/download during status.
- [ ] 7.3 Implement single-owner session start, cached spontaneous final result, finalizing stop, 60s capture limit, 5s stop timeout, cancel/background/interruption teardown and late-callback rejection; cancel/destroy on the main thread. Verify exactly-once result, resources released, busy owner not displaced and no file/document/audio persistence.
- [ ] 7.4 Enforce on-device first and explicit consent for system recognition with unknown/remote processing, blocking it under strict-local requirements without `EXTRA_PREFER_OFFLINE` assumptions. Verify denied disclosure/local-only produce zero capture and no browser/cloud fallback, with physical service/locale checks left to section 11.

## 8. Harden existing Apple live speech for composer purpose

Depends on section 1 speech contract. Acceptance: iOS mic returns finalized text with correct authorization, local-processing constraints and cleanup, while existing lecture/file defaults remain intact.

- [ ] 8.1 Add optional composer purpose/session/locale/local-only arguments and a side-effect-free dictation capability command to the existing Apple plugin/Rust/frontend contract and generated scoped permissions. Verify legacy no-argument callers preserve defaults and speech capability is independent of Foundation Models/file analyzer claims.
- [ ] 8.2 Add explicit microphone and Speech authorization at user start, locale/availability checks, on-device support/request pairing and disclosed network-service policy. Verify permission/support fakes, non-iOS stubs and built plist usage descriptions, including resolving duplicate mic keys in canonical configuration without unrelated generated-project regeneration.
- [ ] 8.3 Replace composer-purpose cached-segment immediate stop with awaited final callback/5s timeout; surface ignored recognition errors, deduplicate termination, cap capture at 60s and retain single audio owner. Verify final-after-stop, no-speech, timeout, double stop, cancellation and stale session tests.
- [ ] 8.4 Clean up audio tap/engine/session and invalidate results on user cancel, background and audio interruptions. Verify draft preservation, no silent restart, no retained composer audio/lecture document and legacy file/lecture contract regressions; physical iPhone verification remains separate.

## 9. Share the composer speech adapter and preserve selection Ask

Depends on sections 2, 5, 7 and 8. Acceptance: mic inserts text once without sending; typing and keyboard dictation work under every failure mode.

- [ ] 9.1 Add shared capability/start/stop/cancel adapter and single capture-owner coordinator under `src/lib/speech/`, selecting native per platform and a disclosed, secure-context Web Speech fallback for browser/PWA only. Verify fake-platform matrix, 10s initialization timeout, strict-local policy, busy ownership and no native-failure→web/cloud substitution.
- [ ] 9.2 Add shared composer hook/control to mobile Panel and AskSheet, with saved draft/caret, listening/Stop state and exactly-once final insertion. Verify append/replacement at selection, browser interim/final dedupe, user-edit cancellation, no automatic send and no permission request simply on opening.
- [ ] 9.3 Cancel capture on close/collapse/Back/background/view-presentation loss/reset and reject stale callbacks. Verify original draft plus explicit edits survive; unsupported/denied/no-speech/timeout/interrupted UI is accessible and offers typing/keyboard dictation guidance without claiming Gboard invocation.
- [ ] 9.4 Preserve AskSheet's request-local reset, page/passage chip editing/removal, suggestions and docked-card actions; suspend global invocation during selection workflow and sequence explicit selection handoff from global. Verify two global turns→selection Ask→global reopen preserves independent messages/draft/scope and document scrollability above selection cards.

## 10. Automated regression and performance verification

Depends on sections 2–9. Acceptance: every normative scenario has a deterministic test or explicitly assigned physical check; no existing navigation behavior is weakened to accommodate Assistant.

- [ ] 10.1 Implement the full automated case matrix in `validation.md` using fake time, pointers, geometry, AI providers and speech/native transports. Verify tests cover native/fallback Back and overlay dedupe, scroll/selection/refresh/joystick coexistence, session context/privacy, accessibility and exact feedback attempts/admissions; run all focused suites.
- [ ] 10.2 Run `npx tsc --noEmit`, targeted ESLint for changed source, `npm run test:run`, `npm run test:scripts`, relevant Rust/plugin tests and Android/iOS native contract/build checks as applicable. Record exact commands/revisions and distinguish preexisting failures; use no GitHub Actions gate.
- [ ] 10.3 Profile invocation under large-PDF/EPUB/video workloads, instrument gesture-to-paint/native admission latency and Panel render count, and add a pure seeded benchmark only where meaningful. Run `npm run bench:check` including bundle budget; inputs use `seededRandom`, bodies return void and consume output. Update baselines/bundle budgets only for justified intentional changes with rationale, never to conceal a regression.
- [ ] 10.4 Run browser/PWA and desktop regression checks, old settings/session fixtures, fullscreen/keyboard/large-text/reduced-motion cases and unchanged edge-origin tests. Record evidence that reader positions and default desktop behavior remain intact; validate this OpenSpec change strictly again.

## 11. Physical-device acceptance and completion evidence

Depends on section 10 and predecessor native haptic/Back acceptance. Acceptance: actual native-device behavior and tactile quality are observed; mock/simulator/build success never substitutes for required hardware rows.

- [ ] 11.1 Build/install Android debug and release/R8 variants using existing acceptance/build notes without uninstalling user data, and build signed native iPhone artifact. Record source revision/diff, artifact hash, OS/device/WebView, recognizer/locale, navigation mode, build flags and scoped permissions in `validation.md` before testing.
- [ ] 11.2 Complete Android both-edge predictive commit/cancel, three-button, IME/fullscreen/picker, overlay, root and reader coexistence rows in `validation.md`; incorporate outstanding predecessor Back acceptance rather than marking it complete from new tests. Verify one logical transition per committed Back and none on cancel.
- [ ] 11.3 Complete physical motor tests on at least two Android OEM phones and a supported iPhone: short/cross/reverse/re-cross/tap/detent/rapid sequences, all intensities, sound independence, app/system disabled, interruption/resume and load. Record felt/not-felt and quality/timing separately from policy/native results; no long/aggressive/double output is accepted.
- [ ] 11.4 Complete Android/iPhone dictation with installed/unavailable locale, permission grant/deny, local-only/offline, explicit network consent, stop/cancel/call/background/busy cases and existing keyboard dictation. Verify final transcription is editable, inserted once and never auto-sent; platform failures follow documented fallbacks.
- [ ] 11.5 Complete TalkBack/VoiceOver, tap-only/switch/keyboard, large text, reduced motion, unsupported-motor/tablet, fullscreen reader and realistic-load frame/latency rows. Verify existing selection Ask remains usable and reader position is unchanged after open/cancel/close.
- [ ] 11.6 Record results and unresolved device-specific failures in `validation.md`, update relevant dependency references without falsifying older checklists, and mark tasks complete only when their evidence exists. Release remains blocked by any mandatory unperformed/failed hardware row; proposal readiness alone is not feature acceptance.

## 12. Searchable command mode (user clarification)

Superseded 2026-10-16 by `update-mobile-assistant-composer`: the tab-based Chat/Commands mode was replaced by the composer add menu. The registry/matcher/availability/executor contract and the completed evidence below remain valid; sheet-level mode switching is no longer part of the presentation.

- [x] 12.1 Add Chat/Commands mode using the existing command registry, matcher, availability gates and executor; preserve Chat state and keyboard palette behavior, cancel capture on mode change, and avoid automatic keyboard focus.
- [x] 12.2 Verify shared command matching/execution, unavailable-action filtering, conversation preservation across modes and dismissal before command action; record evidence in validation.md.
