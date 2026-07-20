## 1. Lock the Arena Contracts

- [x] 1.1 Add shared TypeScript types for the versioned six-grade Arena preview set, five model candidates, recommendation, range, custom bounds, selection source, revisions, and commit ID in `src/api/review.ts`.
- [x] 1.2 Extend `PreviewIntervals` with an optional SM-20 Arena payload while preserving the existing fields consumed by rating buttons and non-SM-20 schedulers.
- [x] 1.3 Extend `submitReview` arguments and Tauri aliases with the optional Arena selection payload and separate decision time.
- [x] 1.4 Add Rust request/response structs with strict model/source enums, schema versioning, finite-number validation, and backward-compatible optional deserialization.
- [x] 1.5 Define typed backend errors for stale preview, invalid custom interval, unsupported Arena mode, invalid model source, and duplicate/idempotent commit handling.
- [x] 1.6 Add a shared model-order fixture that pins `sm2`, `sm15`, `sm19`, `sm20`, and `fsrs` to the existing Arena slot order.

## 2. Expose Deterministic SM-20 Candidates

- [x] 2.1 Refactor the SM-20 review scratch path to return the five raw model slot outputs alongside the weighted ensemble output without changing current committed scheduling results.
- [x] 2.2 Finalize each model slot through the same forgetting-index, lapse, and minimum-growth policy as the ensemble with stochastic dispersal disabled.
- [x] 2.3 Extend the all-grades preview loop to return recommendation, five candidates, weights, personalization flags, range, and custom bounds for every native grade 0-5 in one pass.
- [x] 2.4 Generate relative-independent RFC3339 due timestamps and normalized positive intervals at the backend boundary.
- [x] 2.5 Compute stable item and Arena revision fingerprints from every persisted input that can change candidate output.
- [x] 2.6 Generate a preview ID and schema version without mutating item, collection, optimizer, matrix, weight, or review-history state.
- [x] 2.7 Add Rust unit fixtures for all six grades that pin raw slots, finalized candidates, model order, weighted recommendation, range, and repeat-call determinism.
- [x] 2.8 Add regression tests proving the legacy `again`, `hard`, `good`, `easy`, and `grade_intervals` values are unchanged when the Arena payload is added.
- [x] 2.9 Add non-mutation tests that snapshot the item and full SM-20 collection state before and after repeated Arena previews.

## 3. Persist Arena Decision Provenance

- [x] 3.1 Add the next numbered migration with nullable `schedule_source`, `schedule_model_id`, `arena_commit_id`, `arena_recommended_interval`, `arena_decision_time_ms`, and `arena_snapshot` columns on `review_results`.
- [x] 3.2 Add a unique partial index for non-null `arena_commit_id` values so retries cannot create duplicate review results.
- [x] 3.3 Extend repository review-result creation and reads to round-trip the new optional fields while leaving legacy callers unchanged.
- [x] 3.4 Add repository lookup by Arena commit ID for idempotent retry reconciliation.
- [x] 3.5 Add migration tests proving legacy rows remain readable and duplicate non-null commit IDs are rejected.
- [x] 3.6 Add repository round-trip tests for `arena`, `model`, and `custom` provenance snapshots.

## 4. Commit an Arena Choice Atomically

- [x] 4.1 Add an Arena-aware SM-20 transaction path that begins a database transaction, checks the commit ID, reloads current item/collection state, and validates preview revisions.
- [x] 4.2 Recompute the selected grade's candidates inside the transaction and resolve Arena/model sources from authoritative output rather than client interval values.
- [x] 4.3 Validate custom intervals as finite, positive, and within the recomputed backend bounds.
- [x] 4.4 Apply the grade once, update Arena/model learning once, and patch the chosen value into item due date, item interval, and every internal field representing the actual used interval.
- [x] 4.5 Preserve raw slot predictions separately from the chosen interval so later recall scoring remains model-specific.
- [x] 4.6 Disable stochastic final dispersal for Arena-selected commits so the persisted value matches the confirmed preview; keep direct and Pure M4 behavior unchanged.
- [x] 4.7 Write the learning item, SM-20 collection state, review result/provenance, study statistics, and review-session counters within the same transaction.
- [x] 4.8 Return the prior committed result for a repeated `arena_commit_id` without mutating any state a second time.
- [x] 4.9 Add transaction tests for Arena Pick, each of the five model IDs, valid custom choice, spoofed model interval, stale revision, invalid bounds, rollback on injected failure, and retry idempotency.
- [x] 4.10 Add tests proving model weights respond only to recall prediction loss and do not change merely because a model or Custom was selected.

## 5. Add Browser/PWA Backend Parity

- [x] 5.1 Mirror the five-candidate/all-grade scratch preview in `src/lib/browser-backend.ts` using the shared model order and response schema.
- [x] 5.2 Implement the same revision checks, authoritative model resolution, custom bounds, deterministic selected interval, and commit-ID idempotency in the browser backend.
- [x] 5.3 Persist optional Arena provenance in the browser review-result store without breaking existing IndexedDB data.
- [x] 5.4 Add shared fixtures that compare Tauri and browser candidate intervals, recommendation, range, bounds, and committed result within documented floating-point tolerance.

## 6. Refactor the Review Session State Machine

- [x] 6.1 Replace the eligible SM-20 optimistic grade-and-advance path in `reviewStore.ts` with explicit `question`, `answer`, `arena-loading`, `arena-ready`, and `committing` phases.
- [x] 6.2 Add one `pendingArenaReview` object containing card ID, grade, rating, recall time, decision start, commit ID, preview, selection, and error state.
- [x] 6.3 Prefetch the extended Arena payload with the current card's existing interval preview and select the correct grade entry synchronously after grading when available.
- [x] 6.4 Keep the answer/card/queue/session metrics unchanged while an eligible grade is pending; advance and trigger feedback only after commit succeeds.
- [x] 6.5 Separate recall time from Arena decision time so study-time statistics retain their current meaning and provenance records decision latency.
- [x] 6.6 Implement Back to rating, pending-grade discard confirmation on Review-tab exit/reset, and locked previous/next navigation while Arena work is pending.
- [x] 6.7 Preserve pending grade and selection across preview/commit errors and refresh stale candidates without silently confirming a changed interval.
- [x] 6.8 Extend the undo snapshot and restore command to cover every SM-20 state field changed by the selected actual interval and reconcile the Arena review-result event.
- [x] 6.9 Add store tests for eligible/ineligible routing, no optimistic advance, successful single advance, completion feedback timing, stale refresh, exit discard, navigation lock, retry, and undo.
- [x] 6.10 Add and persist the `automatic` / `choose` Arena review preference, route automatic grades through authoritative Arena Pick without pending UI, and cover both modes with store tests.

## 7. Build the Semantic Arena Stage

- [x] 7.1 Create `AlgorithmArenaDecision.tsx` as the phase container with heading, reviewed-grade context, selected interval/due date, semantic choice group, confirmation, loading, and error regions.
- [x] 7.2 Create `ArenaChoiceRail.tsx` with Arena Pick, five fixed-order models, and Custom as keyboard/touch-operable single-selection targets.
- [x] 7.3 Create locale-aware interval and exact-date formatters that handle sub-day through multi-year values without exposing raw decimal days as the primary label.
- [x] 7.4 Add the selected-choice explanation layer with weighted-pick, earliest/latest, personalized-model, and custom-bound explanations driven by real preview data.
- [x] 7.5 Add the compact two-step first-run guide, persist completion/dismissal in settings, and ensure it never blocks confirmation.
- [x] 7.6 Implement the primary action label as `Schedule for <relative interval>` and keep label, selected option, due date, and submitted source synchronized.
- [x] 7.7 Replace the SM-20 transparency sentence during Arena phase with a collapsible `Why this interval` detail showing weights, model proposals, Arena range definition, and R-Metric only when available.
- [x] 7.8 Add component tests for default selection, every selection source, grade-specific data, first-run guide, confirmation payload, loading, preview error actions, commit retry, and stale interval announcement.
- [x] 7.9 Add a polished two-option Arena mode control in SM-20 Learning settings and beside native review grades, with concise descriptions, recommended state, and semantic radio behavior.

## 8. Implement the Memory Horizon Simulation

- [x] 8.1 Create a pure logarithmic domain/position utility with human-unit tick generation, bounded custom-value conversion, and deterministic collision grouping.
- [x] 8.2 Create `MemoryHorizon.tsx` with Now origin, human time ticks, Arena range, five labeled model markers, Arena Pick marker, selected time lens, and textual parity with the choice rail.
- [x] 8.3 Implement overlapping-marker lanes and cluster focus/cycling so no candidate becomes inaccessible at narrow widths or equal intervals.
- [x] 8.4 Animate marker divergence from Now, selected-lens movement, and confirmation collapse using only transform and opacity with documented CSS timing tokens.
- [x] 8.5 Add reduced-motion and reduced-transparency fallbacks that render final positions immediately on solid semantic surfaces.
- [x] 8.6 Implement Custom mode with explicit activation, numeric value/unit entry, log-scale pointer capture, CSS-variable drag updates, meaningful haptic ticks, bounds text, and exact-date preview.
- [x] 8.7 Add unit/property tests for log mapping round trips, extreme ranges, sub-day values, equal intervals, custom clamping, tick labels, and collision stability.
- [x] 8.8 Add screenshot/DOM tests in light and dark themes for representative tight, moderate, and multi-year candidate spreads.

## 9. Integrate Desktop, Mobile, Zen, and Audio Flows

- [x] 9.1 Integrate the Arena phase into `ReviewSession.tsx`, keeping the reviewed answer visible and allowing the stage to span the desktop review workspace.
- [x] 9.2 Add desktop shortcuts: Left/Right traversal, model keys 1-5, `A` for Arena Pick, `M` for Custom, Enter/Space confirm, and Escape back to rating without conflicting with grade shortcuts.
- [x] 9.3 Implement the below-768px single-column layout with constrained answer context, scroll-snap choice rail, swipe traversal, 44px targets, dynamic viewport sizing, and persistent safe-area confirmation.
- [x] 9.4 Integrate preference-aware haptics so touch feedback fires once per settled candidate or meaningful custom unit boundary.
- [x] 9.5 Render the same Arena decision state in `ZenReviewMode.tsx` with reduced chrome and no duplicate scheduling logic.
- [x] 9.6 Update hands-free audio auto-advance to commit Arena Pick, announce the relative interval, and stop in the recoverable Arena error state if commit fails.
- [x] 9.7 Verify cram, Pure M4, non-SM-20, Queue reading mode, legacy widgets, and other excluded surfaces retain current behavior.
- [x] 9.8 Add responsive tests at 320px, 375px, 768px, 1024px, and wide desktop widths, including iOS/Android safe-area fixtures and landscape phone orientation.
- [x] 9.9 Replace the mobile overlay-style confirmation footer with a reserved flex action dock, regression-test non-overlap containment across phone, landscape, and desktop viewports, and reuse the contained layout in Zen mode.

## 10. Accessibility and Localization

- [x] 10.1 Add English Arena strings for headings, model choices, intervals, due dates, explanations, shortcuts, guide, custom bounds, errors, stale updates, discard confirmation, and audio announcements.
- [x] 10.2 Add complete translations for every new key across the existing Chinese, German, Spanish, French, and Japanese locale files.
- [x] 10.3 Implement radiogroup semantics, selected state, roving focus or native radio behavior, polite live-region announcements, and decorative timeline hiding where appropriate.
- [ ] 10.4 Verify all controls have visible focus, logical reading order, 44px touch targets, non-color state cues, and WCAG AA contrast in both themes.
- [x] 10.5 Add automated accessibility tests for names, roles, selected state, focus restoration, keyboard-only completion, error announcements, reduced motion, and zoom to 200%.
- [ ] 10.6 Perform manual VoiceOver and TalkBack passes for reviewing choices, changing selection, entering Custom, refreshing stale data, and confirming.
- [x] 10.7 Localize the Arena review-mode choice and its automatic/interactive explanations across every existing locale.

## 11. Sync, Export, and Analytics Plumbing

- [x] 11.1 Extend `SyncedReviewResult` and `publishReview` with optional Arena source, model, recommendation, decision time, candidate snapshot, and commit ID.
- [x] 11.2 Update Rust sync ingestion/export paths to accept and persist the optional Arena fields while ignoring them safely on older data.
- [x] 11.3 Extend collection archive export/import and review-result query APIs with the versioned provenance fields.
- [x] 11.4 Add sync and archive round-trip tests for Arena Pick, model, Custom, and legacy no-provenance review events.
- [x] 11.5 Exclude Arena decision time from recall-time retention analytics while making it available for future UX analytics.

## 12. Final Verification and Rollout

- [x] 12.1 Add an internal feature flag that gates only the frontend decision phase and leaves the selection-aware backend backward compatible when disabled.
- [x] 12.2 Run targeted frontend unit/integration tests for review store, RatingButtons, ReviewSession, Memory Horizon, Zen mode, audio mode, sync, and browser parity.
- [x] 12.3 Run targeted Rust tests for SM-20 preview, selection validation, transaction rollback, persistence, idempotency, sync, and export/import.
- [x] 12.4 Run TypeScript checking, production build, lint for changed files, and the existing review regression suites.
- [ ] 12.5 Test a real review session on desktop and a physical mobile device in light/dark, touch/keyboard, normal/reduced-motion, online/offline, and slow-preview conditions.
- [ ] 12.6 Profile preview and interaction responsiveness on low-end mobile hardware; confirm candidate prefetch does not block card reveal and drag does not trigger per-frame React renders.
- [x] 12.7 Verify no excluded review surface changed and no review can advance, count, sync, or celebrate before an eligible Arena commit succeeds.
- [x] 12.8 Document the Memory Horizon interaction, keyboard shortcuts, custom-interval implications, Arena range meaning, and hands-free exception in the user handbook and release notes.
- [x] 12.9 Remove the internal feature flag only after parity, accessibility, mobile, and rollback checks pass, or leave it available as the release rollback switch.
- [x] 12.10 Run targeted preference, review-store, settings UI, production build, and PWA build verification for automatic and choose modes.
