# Guided Onboarding Tour — Manual Verification Checklist

Tasks 9.4 and 9.5 from `tasks.md` require running the actual Tauri app on
three platforms with a human eye and a screen reader. They cannot be
completed by an automated agent. This document is the checklist for the
human pass.

## 9.4 — Cross-platform visual pass

Run the full tour on each platform by triggering it from **Settings → Help &
Tour → Replay guided tour**, or via the command palette (**Cmd/Ctrl+K** →
"Start guided tour"), or the Vimium command `:tour`.

For each platform verify:

- [ ] **macOS (WKWebView)** — spotlight cutout snaps to each anchor with the
      320 ms `cubic-bezier(0.4, 0, 0.2, 1)` travel; coach mark fades and
      translates 8 px over 180 ms; per-chapter SVG illustration animates on
      the centred-card steps.
- [ ] **Windows (WebView2)** — same motion tiers; the four-dim-panel
      approach (no `clip-path` animation) holds up. Confirm the dim panels
      meet at the anchor corners with no visible seam.
- [ ] **Linux (WebKitGTK)** — same motion tiers; this is the webview most
      likely to diverge on animation primitives, which is exactly what the
      four-panel design avoids.

On each platform specifically check:

- [ ] Spotlight tracks the anchor when the window is resized mid-step.
- [ ] Coach mark flips from `bottom` → `top` (or to a perpendicular side)
      when the preferred placement would push it off-screen, and never
      covers the anchor.
- [ ] Anchor that lives inside a scroll container is scrolled into view
      before the spotlight draws (queue controls when the queue list is
      long, for example).
- [ ] Mobile shell (force mobile mode via dev tools or a phone/PWA build):
      chapter rail collapses to dots, coach mark uses bottom-sheet
      placement below the anchor.
- [ ] Rapidly clicking Next lands on the correct final step with no queued
      transitions or visual artefacts; controls stay responsive mid-transition.

## 9.5 — Keyboard and screen-reader pass

With the tour open:

- [ ] `Tab` cycles only among the coach-mark controls (Back, Next, Skip)
      and never reaches the dimmed application behind it.
- [ ] `→` / `Enter` advances; `←` goes back; `Esc` dismisses softly.
- [ ] On the first step Back is disabled and `←` does nothing.
- [ ] On the last step the primary button reads "Done" and closes the tour
      as completed.
- [ ] The coach mark is exposed as `role="dialog"` with an accessible name
      equal to the step title (verify with VoiceOver / NVDA / Orca).
- [ ] On step change the new title and body are announced (live region).
- [ ] Closing the tour by any path returns focus to the element that had
      it before the tour opened.
- [ ] Under **Settings → Appearance → Reduce motion** (or the OS
      `prefers-reduced-motion` signal), all motion tiers collapse to
      instant repositioning and the illustration holds a static frame.

## 9.6 — Automated checks (already passing)

- Vitest suite: all tour tests green (62 tests across 6 files), plus the
  full suite with no new failures introduced by the change. The two
  remaining red tests (`notebooklm.integration`, `WorkspaceSwitcher`) fail
  on baseline `main` as well and are unrelated to onboarding.
- `tsc --noEmit`: clean for all new and modified files.
- `vite build`: production bundle builds clean.
- `eslint`: not run — `eslint` is not installed in this environment. The
  new code follows the project's existing style; `npm run lint` should be
  run in a fully-installed working tree before release.
