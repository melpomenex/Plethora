# Add Guided Onboarding Tour

## Why

Incrementum is a deep app — documents, extracts, queue, review algorithms, Knowledge Sphere, collections, workspaces, split panes — and a new user lands on it with no idea where anything lives or how the import → extract → review loop fits together. Onboarding components were written (`src/components/onboarding/WelcomeScreen.tsx`, `InteractiveTutorial.tsx`, `FSRSExplanationModal.tsx`) but were never wired into the app: nothing imports them, and only one tour anchor (`data-tutorial="import-button"`) exists in the entire UI. So today there is effectively zero onboarding.

The failure mode to avoid is the opposite one: a modal that reappears on every launch and trains users to dismiss dialogs reflexively. The tour must be genuinely skippable, must stop asking after a small number of launches, and must remain available on demand afterwards.

## What Changes

- **A guided, animated tour** that walks the user through the app's real surfaces — Dashboard, Documents/Import, Reader & extract creation, Queue, Review, Analytics/Knowledge Sphere, Settings — using a spotlight overlay anchored to actual UI elements rather than screenshots.
- **A tour anchor registry**: `data-tour="<id>"` attributes added across the shell and feature views, with a typed catalogue of anchor IDs so steps and markup cannot drift apart silently.
- **Motion design**: animated spotlight travel between anchors, coach-mark entrance/exit, and per-step illustrative micro-animations — all gated on the existing `PresentationContext.reducedMotion` signal, which falls back to a static crossfade.
- **Skippable everywhere**: `Esc`, an always-visible "Skip tour" control, and click-outside all end the tour immediately with no confirmation nag. Skipping is remembered.
- **Bounded auto-display**: the tour auto-opens on at most 3 app launches after install. Completing it, skipping it, or exhausting the 3 launches permanently disables auto-display. It never auto-opens mid-session, only at startup after the shell is ready.
- **Always available on demand**: replay entry points in Settings → Help, the command palette, and the Vimium-style command list, which reset progress and open the tour regardless of auto-display state.
- **Resumable progress**: closing mid-tour and reopening later resumes at the last step reached.
- **Adaptive**: steps whose anchor is absent on the current viewport (mobile nav vs. desktop sidebar) resolve to a fallback anchor or are skipped rather than pointing at nothing.
- **Chapter-based structure** so the user can jump between sections and see how far they are, instead of enduring an opaque N-of-M linear slog.
- The three dead onboarding components are either rewired into the new flow or removed; there will be exactly one onboarding surface, not two competing ones.

## Capabilities

### New Capabilities

- `onboarding-tour`: the guided tour experience itself — step/chapter model, spotlight anchoring, navigation, skip, resume, animation behaviour, accessibility, and adaptive anchor resolution.
- `onboarding-display-policy`: when the tour is allowed to auto-open — launch counting, the terminal states that disable auto-display forever, on-demand replay entry points, and how that state is persisted and synced.

### Modified Capabilities

<!-- None. No existing spec in openspec/specs/ defines onboarding or startup-modal behaviour. -->

## Impact

- **New code**: `src/components/onboarding/tour/` (overlay, spotlight, coach mark, chapter rail, step definitions, anchor catalogue), `src/hooks/useOnboardingTour.ts`, `src/lib/onboardingTour.ts` (display-policy state).
- **Modified code**:
  - `src/components/layout/MainLayout.tsx` — mount the tour host, add startup trigger, add `data-tour` anchors, register replay in the Vimium command list.
  - `src/components/documents/DocumentsView.tsx`, queue/review/analytics/settings views, `src/components/mobile/MobileNavigation.tsx` — add `data-tour` anchors.
  - `src/lib/localStorageSync.ts` — register the new persistence key so tour state travels with the user's synced settings.
  - `src/components/settings/SettingsPage.tsx` — "Replay guided tour" control.
  - `src/lib/i18n` locale files — new `onboarding.tour.*` strings; reconcile existing `onboarding.*` keys.
  - `src/components/onboarding/{WelcomeScreen,InteractiveTutorial,FSRSExplanationModal}.tsx` — superseded; folded in or deleted.
- **No backend changes**: state lives in `localStorage` under the existing settings-sync mechanism; no Rust/Tauri commands, no schema migration.
- **Dependencies**: none added. Animation via CSS transitions/`Web Animations API` and existing Tailwind config — no new animation library.
- **Risk**: anchors are markup-coupled; mitigated by the typed anchor catalogue plus a test asserting every step's anchor ID exists in the catalogue and that unresolvable anchors degrade rather than break.
