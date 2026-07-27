## 1. Display-policy foundation

- [x] 1.1 Create `src/lib/onboardingTour.ts` with the versioned `OnboardingTourState` type (`version`, `launchCount`, `autoDisplayDisabled`, `furthestStepId`, `completedAt`) and read/write helpers over the `incrementum-onboarding-tour` localStorage key
- [x] 1.2 Implement state hardening in the reader: missing/unparseable/partial record → fresh-install defaults; `version` newer than known → auto-display suppressed rather than reset
- [x] 1.3 Implement the transition functions — `markCompleted()`, `markSkipped()`, `markDismissed()` (soft, preserves budget), `markOptedOut()`, `recordResumePosition(stepId)`, `resetOnboardingState()` — each writing the whole record, never partial fields
- [x] 1.4 Register `incrementum-onboarding-tour` in the synced key allowlist in `src/lib/localStorageSync.ts`
- [x] 1.5 Unit-test the policy in `src/lib/__tests__/onboardingTour.test.ts`: launch budget of 3, soft dismissal preserving budget, explicit skip and completion as terminal, corrupt-state recovery, future-version suppression, reset behaviour
- [x] 1.6 Implement forward migration in `readOnboardingTourState()`: a well-formed record whose `version` is older than `ONBOARDING_TOUR_VERSION` is migrated (fields carried forward, new fields defaulted) rather than falling into the corrupt-state branch; only a record that also fails field validation at that older version resets to fresh. Unit-test all three scenarios added to `onboarding-display-policy/spec.md`'s "Older state versions migrate forward" requirement.

## 2. Anchor catalogue

- [x] 2.1 Create `src/components/onboarding/tour/anchors.ts` exporting a frozen `TOUR_ANCHORS` map, the derived `TourAnchorId` type, and a `tourAnchor(id)` helper returning `{ "data-tour": id }`
- [x] 2.2 Implement `resolveAnchor(candidates)` — first candidate that is in the DOM, has a non-zero bounding box, and is not `visibility: hidden` (a collapsed sidebar item must not resolve)
- [x] 2.3 Add shell anchors in `src/components/layout/MainLayout.tsx`: dashboard, documents, queue, review, analytics, Knowledge Sphere, settings nav targets, workspace switcher, theme control
- [x] 2.4 Add mobile-shell anchors in `src/components/mobile/MobileNavigation.tsx` for each nav destination that has a desktop counterpart
- [x] 2.5 Migrate `data-tutorial="import-button"` at `src/components/documents/DocumentsView.tsx:966` to `data-tour`, and add the documents-grid and URL/command-palette import anchors
- [x] 2.6 Add reader/extract anchors (reader root of the active pane, extract action, extracts panel) and queue/review anchors (queue controls, grading controls, algorithm selector)
- [x] 2.7 Write `src/components/onboarding/tour/__tests__/anchors.test.tsx` asserting every anchor ID referenced by any step exists in `TOUR_ANCHORS`, and that rendering the shell resolves every non-optional anchor

## 3. Overlay primitives

- [x] 3.1 Implement `useAnchorRect(candidates)` — resolves the anchor, tracks its box via `ResizeObserver` plus rAF-throttled passive `resize`/`scroll` listeners, and returns `null` when nothing resolves
- [x] 3.2 Implement `TourSpotlight` as four dimming panels (top/right/bottom/left) plus a rounded ring around the anchor; no `clip-path` animation
- [x] 3.3 Implement scroll-into-view for anchors outside the visible scroll area, respecting the reader's own scroll containers
- [x] 3.4 Implement `TourCoachMark` with placement preference and flip/shift fallback so the card is always fully within the viewport and never covers the anchor
- [x] 3.5 Add mobile-shell chrome: bottom-sheet placement when `isMobileShell`, chapter rail collapsed to a dot indicator
- [x] 3.6 Implement focus trap, `role="dialog"` labelled by step title, live-region announcement on step change, and focus restoration to the pre-tour element on close
- [x] 3.7 Verify coach-mark text meets WCAG AA contrast against its own background in both light and dark themes

## 4. Tour engine

- [x] 4.1 Define the step/chapter model in `src/components/onboarding/tour/types.ts` — `anchor?: TourAnchorId | TourAnchorId[]`, `requiresAnchor?`, placement, optional micro-animation
- [x] 4.2 Implement `useOnboardingTour()` holding open state, current step, resolved step list (steps whose `requiresAnchor` is true and whose anchors do not resolve are excluded from the list and from the displayed total)
- [x] 4.3 Implement navigation: Next/Back plus `→`/`Enter`/`←` keys, Back disabled on the first step, Done on the last step closing and marking complete
- [x] 4.4 Implement close paths: `Esc` and overlay-click as soft dismissal, "Skip tour" and "Don't show again" as terminal, none showing a confirmation prompt
- [x] 4.5 Implement resume — persist the furthest step reached on close; reopening resumes there; a completed tour restarts at step 1 with progress reset; a stored step ID absent from the current definition falls back to step 1
- [x] 4.6 Implement chapter jumping from the chapter rail, resolving and animating to the target chapter's first step
- [x] 4.7 Implement non-destructive view navigation: record the active view/tab state before a step navigates, restore it when the tour closes
- [x] 4.8 Assert no data mutation — the tour module must not import document, extract, queue, or scheduling write APIs; add a test covering a full completion run on a populated fixture library showing zero records touched

## 5. Motion

- [x] 5.1 Implement spotlight travel — panel geometry transition, 320ms, `cubic-bezier(0.4, 0, 0.2, 1)`
- [x] 5.2 Implement coach-mark enter/exit — fade plus 8px translate, 180ms, staggered 60ms behind the spotlight
- [x] 5.3 Build the per-chapter illustrative micro-animations as pure CSS keyframes over inline SVG; no animation library, no video assets
- [x] 5.4 Gate all three tiers on `PresentationContext.reducedMotion` via the existing `root.dataset.reducedMotion` attribute selector — instant repositioning, static illustration frame, no looping decoration
- [x] 5.5 Verify rapid Next/Back clicking lands on the correct final step with no queued transitions or visual artefacts, and that controls stay responsive mid-transition

## 6. Content

- [x] 6.1 Author the seven chapters and their steps in `src/components/onboarding/tour/steps.ts` — Welcome, Bring things in, Read & extract, The queue, Review, See your knowledge, Make it yours
- [x] 6.2 Migrate usable step copy from `InteractiveTutorial.tsx` and `WelcomeScreen.tsx` into the new definitions
- [x] 6.3 Add `onboarding.tour.*` strings to the locale files under `src/lib/i18n`, reconciling the existing `onboarding.*` keys rather than duplicating them
- [x] 6.4 Mark reader-chapter steps `requiresAnchor: false` so they render as centred illustrated cards when no document is open — the tour must never open a document to make a point

## 7. Wiring and entry points

- [x] 7.1 Mount the tour host in `src/components/layout/MainLayout.tsx`
- [x] 7.2 Implement `useOnboardingAutoOpen()` with all six gates: shell rendered and anchors mounted, no pending startup notice (reusing the existing `consume_startup_notice` handling, not a second poller), catch-all route only, no document/review deep link, budget available and not disabled, and a module-level once-per-session flag
- [x] 7.3 Increment `launchCount` at the auto-open decision point so ineligible sessions never consume budget
- [x] 7.4 Add "Replay guided tour" and "Reset onboarding" to `src/components/settings/SettingsPage.tsx`; replay opens from step 1 with progress reset and leaves `launchCount`/`autoDisplayDisabled` untouched
- [x] 7.5 Register a guided-tour command in `src/components/common/CommandPalette.tsx` and in the Vimium command list in `MainLayout.tsx`

## 8. Remove the superseded surfaces

- [x] 8.1 Delete `src/components/onboarding/InteractiveTutorial.tsx` and `WelcomeScreen.tsx` once their content has moved (task 6.2)
- [x] 8.2 Fold `FSRSExplanationModal.tsx` into the Review chapter or delete it; ensure no startup path mounts it
- [x] 8.3 Confirm `OCROnboarding.tsx` and `SignupPrompt.tsx` are untouched and still reachable from their own feature paths
- [x] 8.4 Verify no competing modal opens alongside the tour at startup

## 9. Verification

- [x] 9.1 Integration test of the auto-display policy against the real shell: auto-opens on launches 1–3, silent on launch 4, silent after completion, silent after explicit skip
- [x] 9.2 Integration test that a pending startup notice or a deep-linked launch suppresses the tour without consuming budget
- [x] 9.3 Test adaptive anchoring: mobile-shell viewport resolves mobile nav candidates, unresolvable optional anchors render centred cards, unresolvable required anchors drop from the step count
- [ ] 9.4 Run the full tour manually on macOS, Windows, and Linux — spotlight geometry, animation smoothness, and coach-mark placement on each webview per the project's stated testing strategy
- [ ] 9.5 Keyboard-only and screen-reader pass: full traversal via keyboard, step announcements, focus trap, focus restoration
- [x] 9.6 Run `npm run lint` and the Vitest suite clean
