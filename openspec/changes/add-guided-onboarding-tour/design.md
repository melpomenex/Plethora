## Context

Incrementum's shell is `src/components/layout/MainLayout.tsx` (~1280 lines): a `HashRouter` catch-all route that hosts a tabbed workspace with split panes, a Vimium-style command layer, a command palette (`src/components/common/CommandPalette.tsx`), and view-level pages for dashboard, documents, queue, review, analytics, Knowledge Sphere and settings. Mobile uses the same shell with `MobileNavigation` and `MobileLayoutWrapper` swapped in, driven by `PresentationContext` (`mode`, `isMobileShell`, `reducedMotion`).

Current onboarding state of the world:

- `src/components/onboarding/` contains `WelcomeScreen.tsx` (226 lines), `InteractiveTutorial.tsx` (620 lines), `FSRSExplanationModal.tsx` (404), `SignupPrompt.tsx` (76), `OCROnboarding.tsx` (386). Only `OCROnboarding` is genuinely feature-scoped; `WelcomeScreen`, `InteractiveTutorial` and `FSRSExplanationModal` are **not imported anywhere** — dead code.
- `InteractiveTutorial` already models the right idea (steps with `targetSelector`, `spotlight`, `position`) and already references `onboarding.*` i18n keys, but its anchors were never added: `data-tutorial` appears in exactly one place in the codebase, `DocumentsView.tsx:966`.
- No first-run, launch-count, or "onboarding seen" flag exists anywhere in `src/` or `src-tauri/src/`.
- Settings-shaped state lives in `localStorage` and is replicated across devices via the key allowlist in `src/lib/localStorageSync.ts`.

So this is not "wire up the existing tutorial" — the anchor surface it depends on does not exist, and the display policy that keeps it from becoming a nag does not exist either. This design covers building both, and folding the useful parts of `InteractiveTutorial` into the result.

Constraints that shape the design:

- Tauri v2 builds with `inlineDynamicImports: true` — everything lands in one bundle, so a heavy tour library is paid for by every user on every launch whether or not they see the tour.
- Three webviews (WKWebView / WebView2 / WebKitGTK). Anything relying on bleeding-edge CSS (e.g. `clip-path` animation semantics) needs a conservative fallback.
- The shell can already be showing a startup notice at boot (`consume_startup_notice` polling in `MainLayout.tsx:256+`, auto-backup-found restore prompts, etc.). The tour must lose that race deliberately, not accidentally.

## Goals / Non-Goals

**Goals:**

- One coherent guided tour that points at the real, live UI and feels designed rather than bolted on.
- A display policy that is aggressive exactly three times and then silent forever, with an always-available manual entry point.
- Anchors that cannot silently rot: a typed catalogue plus a test that fails the build when a step references an unknown anchor.
- Motion that is a genuine part of the UX on capable machines and fully disappears under `prefers-reduced-motion`.
- Works on desktop and the mobile shell without maintaining two tour definitions.

**Non-Goals:**

- No demo/sample content seeding. `src/lib/demoContent.ts` and the separate `add-demo-mode-with-onboarding` change own that; this tour explains the app, it does not populate it.
- No auth or sign-up funnel. `SignupPrompt` is out of scope.
- No per-feature contextual coach marks fired by usage heuristics ("you've imported 5 PDFs, did you know…"). This is a one-shot tour, not a nudge engine.
- No backend/Rust changes, no DB schema, no new Tauri command.
- No A/B testing or onboarding funnel analytics.

## Decisions

### D1: Build the tour, don't adopt a library

**Decision:** Implement the overlay in-house under `src/components/onboarding/tour/`. No `react-joyride`, `driver.js`, `shepherd.js`, or `intro.js`.

**Why:** With `inlineDynamicImports: true` the library's weight is unconditional and unshakeable — every user pays for a tour most will see three times at most. The behaviour we actually need is narrow: a dimmed overlay with a cutout, a positioned card, keyboard handling, and focus trapping. The parts that are genuinely fiddly (flip/shift placement, focus trap) are already solved patterns in this codebase's other overlays. And every library on the list wants control of theming and animation, which is exactly the part we care most about getting right.

**Alternatives considered:** `driver.js` (smallest, ~5kB, but its highlight model fights split-pane layouts and its theming hooks are CSS-override-based); `react-joyride` (best React ergonomics, but ~40kB and opinionated about scroll behaviour in ways that conflict with the reader's own scroll containers).

### D2: Spotlight via four dimming panels, not `clip-path`

**Decision:** Render the dim layer as four absolutely-positioned rectangles (top/right/bottom/left of the anchor rect) plus a rounded, non-dimming "ring" element around the anchor. Animate each panel's geometry.

**Why:** A single full-screen dim with a `clip-path` cutout is the elegant version, but animating `clip-path` between two rounded rects is inconsistent across WebKitGTK and WebView2, and interpolation of `path()` is not reliably supported. Four panels animate as plain `transform`/`inset` transitions — GPU-friendly, uniform across all three webviews, and they naturally leave the anchor genuinely interactive if a step ever wants that.

**Trade-off:** Slightly more layout math, and the "cutout" corner radius comes from the ring element rather than the mask itself, so the dim is a hard rectangle at the corners. In practice invisible at the dim opacities used.

### D3: Anchors are a typed catalogue, not free-form selectors

**Decision:** `src/components/onboarding/tour/anchors.ts` exports a frozen object of anchor IDs (`export const TOUR_ANCHORS = { navQueue: "nav-queue", documentsImportButton: "documents-import-button", … } as const`) and a `tourAnchor(id)` helper returning `{ "data-tour": id }` for spreading onto elements. Step definitions may only reference `TourAnchorId`.

**Why:** The existing `data-tutorial` attribute demonstrates the failure mode precisely — one anchor was added, the tutorial referenced five, and nothing ever complained. A typed catalogue makes the reference side compile-checked, and a unit test walking the rendered shell asserts the presence side. Free-form CSS selectors (`InteractiveTutorial`'s current approach) couple the tour to markup structure and break on any refactor without a signal.

**Also:** `data-tutorial="import-button"` on `DocumentsView.tsx:966` gets migrated to `data-tour` and the old attribute removed, so there is one convention.

### D4: Steps declare *candidate* anchors, ordered by preference

**Decision:** `anchor?: TourAnchorId | TourAnchorId[]`, resolved first-present-and-visible. Plus `requiresAnchor?: boolean` to distinguish "this step is pointless without its target" (skip it) from "this step still reads fine as a centred card" (degrade).

**Why:** This is how one tour definition serves desktop and mobile. The queue lives in a sidebar item on desktop and a bottom-nav item on mobile; rather than branching the definition on `isMobileShell`, the step lists both and takes whichever exists. It also makes the tour robust to features being hidden by settings or feature flags (`src/lib/featureFlags.ts`) — a step for a disabled feature quietly drops out.

**Visibility test:** present in DOM *and* has a non-zero bounding box *and* is not `visibility: hidden` — a collapsed sidebar's items are in the DOM with zero width and must not count as resolved.

### D5: Display policy is a single versioned record in `localStorage`, registered for sync

**Decision:**

```ts
// src/lib/onboardingTour.ts
type OnboardingTourState = {
  version: 1;
  launchCount: number;       // startup sessions where auto-display was eligible
  autoDisplayDisabled: boolean; // terminal: completed | skipped | opted out
  furthestStepId: string | null; // resume position
  completedAt: string | null;
};
```

Stored under `incrementum-onboarding-tour`, added to the allowlist in `src/lib/localStorageSync.ts` so it replicates with the user's other settings.

**Why one record, not several flags:** the policy has interacting fields (a soft dismissal consumes budget but does not set the terminal flag; an on-demand replay must touch neither). Separate keys invite partial writes and inconsistent states. One versioned object is read once at startup, written on transitions.

**Why `localStorage` and not SQLite:** it is settings-shaped, tiny, needed synchronously before the shell paints, and the sync mechanism for exactly this class of state already exists. A Tauri command would add an async round-trip in the boot path for no benefit, and would not work in the browser/PWA build.

**Version handling:** unparseable or missing fields → treat as fresh install. `version` **greater** than known → suppress auto-display rather than reset, so a user who downgrades is not re-onboarded. This asymmetry is deliberate: the cost of wrongly re-showing is user-visible annoyance; the cost of wrongly suppressing is a tour they can still open from Settings.

### D6: Launch budget is consumed only by *eligible* sessions

**Decision:** `launchCount` increments only when the session was actually a candidate for auto-display — i.e. the shell rendered, no startup notice/restore/migration dialog was showing, and the app was not deep-linked into a document, review session, or the `screenshot-overlay` route. Otherwise the session is a no-op against the budget.

**Why:** Otherwise the budget silently burns down during exactly the sessions where the user could never have seen the tour. Someone who opens the app three times via "open with" on a PDF would exhaust their onboarding without ever being offered it. Coupling the counter to eligibility rather than to process start keeps "3 chances" honest.

**Implementation note:** this means the increment happens *at the auto-open decision point*, not at module load.

### D7: Skip semantics are graded — explicit skip is terminal, `Esc` is not

**Decision:** "Skip tour" / "Don't show again" set `autoDisplayDisabled: true`. `Esc` and overlay-click are soft: they close and save the resume position, consuming one launch from the budget but leaving the remaining launches intact.

**Why:** These are different intents. Clicking a labelled "Skip tour" button is a decision. Hitting `Esc` is very often reflex — the user is mid-thought, wants the overlay gone, and would still like to see it later. Treating the reflex as a permanent opt-out is how tours get a reputation for being un-findable. The budget still bounds the total annoyance at 3.

**Risk acknowledged:** a user who reflexively `Esc`s sees the tour up to three times. That is the intended ceiling, and each occurrence is one keystroke to clear.

### D8: Auto-open sequencing

The trigger lives in a `useOnboardingAutoOpen()` hook mounted in `MainLayout`, gated on:

1. shell rendered and tour anchors mounted (one `requestAnimationFrame` after the layout's first committed paint, plus a check that the shell's root anchor resolves),
2. no startup notice pending — reuse the existing `consume_startup_notice` result already handled in `MainLayout.tsx:256+` rather than adding a second poller,
3. route is the catch-all `*` (not `/auth/callback`, not `/screenshot-overlay`),
4. no document/review deep link in the initial hash,
5. `!autoDisplayDisabled && launchCount < 3`,
6. `!alreadyAutoOpenedThisSession` (module-level flag, deliberately not persisted).

Only when all six hold does it increment `launchCount` and open.

### D9: Chapters map to the real product loop

Seven chapters, sized so the whole thing is ~2 minutes:

| Chapter | Steps | Anchors |
|---|---|---|
| Welcome | 1 | none (centred, animated logo/orientation) |
| Bring things in | 3 | import button, URL/command-palette import, documents grid |
| Read & extract | 3 | reader surface, extract action, extracts panel |
| The queue | 2 | nav queue (desktop/mobile candidates), queue controls |
| Review | 3 | nav review, grading controls, algorithm selector in settings |
| See your knowledge | 2 | analytics nav, Knowledge Sphere nav |
| Make it yours | 2 | settings nav, theme/workspace switcher |

Steps that navigate the app to their subject record the prior view/tab state and restore it on close (spec: "Navigation during the tour is non-destructive").

**Why chapters and not a flat 16-step counter:** "Step 4 of 16" reads as a chore. A visible chapter rail with 7 named sections lets the user see the shape of the app before they've seen the app, and lets them jump straight to the part they care about — which is the single most common reason people abandon linear tours.

### D10: Motion budget

Three tiers, all driven off `usePresentation().reducedMotion`:

- **Spotlight travel** — panel geometry transitions, 320ms, `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Coach mark** — fade + 8px translate on enter/exit, 180ms, staggered 60ms after the spotlight starts so the card lands as the light settles.
- **Step micro-animations** — small inline SVG/CSS loops illustrating each chapter's concept (a card flipping, an extract lifting out of a paragraph). Pure CSS keyframes, no runtime library, no video assets.

Under reduced motion: all three collapse to instant repositioning and a static illustration frame. `PresentationContext` already publishes `reducedMotion` and stamps `root.dataset.reducedMotion`, so the CSS tier can be handled with an attribute selector rather than threading props.

Rapid Next-clicking must not queue transitions: the spotlight target is stored as state and the transition is declarative (CSS transitions to whatever the current geometry is), so a fast sequence naturally lands on the final position.

### D11: Geometry tracking

A `useAnchorRect(anchorIds)` hook resolves the anchor and tracks its box via `ResizeObserver` on the element plus a `window` resize/scroll listener (passive, rAF-throttled). Not `MutationObserver` — too noisy in a shell with a live queue and sync indicators.

**Trade-off:** an anchor that moves due to a sibling's layout change without itself resizing and without a window event will not be tracked until the next event. Accepted; the alternative is a per-frame polling loop for the entire duration of the tour.

## Risks / Trade-offs

- **Anchors rot as the UI is refactored** → typed catalogue (D3) makes the reference side compile-checked; a test renders the shell and asserts every non-optional anchor resolves, failing CI when markup drops one. Steps degrade to centred cards rather than breaking (D4).
- **`launchCount` desync across devices via settings sync** → a user could land on a second device with the counter already at 3 and never be offered the tour there. Accepted deliberately: they are not a new user, and Settings → Replay is one click.
- **Tour races the startup notice / restore prompt** → D8's explicit gating, reusing the existing notice channel instead of adding a competing one. The tour is the lowest-priority startup surface by construction.
- **Mobile shell has less room for a coach mark** → placement resolver flips to bottom-sheet-style placement below `isMobileShell`; the chapter rail collapses to a dot indicator. Same definition, different chrome.
- **Split panes make "the reader" ambiguous** → reader-chapter anchors attach to the active pane's reader root; if no document is open, those steps are `requiresAnchor: false` and render as centred cards with the illustrative animation instead. The tour never opens a document to make a point.
- **Deleting `InteractiveTutorial` loses work** → its step copy and i18n keys migrate into the new definitions before deletion; the diff should show strings moving, not vanishing. Existing `onboarding.*` locale keys are reconciled rather than duplicated under a fresh namespace where they still apply.
- **Three webviews, one animation** → D2 avoids the known-divergent primitive; verification is manual on all three platforms per the project's stated testing strategy.

## Migration Plan

No data migration. State starts absent and is created on first eligible launch, which reads as a fresh install — which it is, for every existing user. Every existing user therefore gets the tour offered up to 3 times on upgrade. That is intended: they have never been shown it.

Rollback: the change is additive and self-contained. Reverting removes the tour host from `MainLayout`, the `data-tour` attributes (inert if left), and the sync-key registration. Orphaned `incrementum-onboarding-tour` records in `localStorage` are harmless.

## Open Questions

- Should upgrading existing users be treated as fresh (offered the tour 3×, as above) or given a single, quieter "what's here" pass? Current design says treat as fresh; worth a second opinion since it means a tour appearing for long-time users after an update.
- Does the review chapter need a live, non-destructive demo card the user can actually grade, or is an illustrative animation enough? A live card is far more convincing but risks touching scheduling state, which the spec forbids — it would need a sandboxed non-persisting review surface.
- `OCROnboarding` and `SignupPrompt` remain separate surfaces. Should the tour eventually absorb them, or do feature-scoped onboardings stay independent?
