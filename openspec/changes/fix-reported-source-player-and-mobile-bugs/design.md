## Context

Four surfaces, four different root causes, one shared constraint: all four are user-visible and all four are *reported working but not working*, so the interesting part of each fix is establishing which layer actually owns the failure. Findings are in `proposal.md` — Why. What follows is only the state and the constraints that shaped the approach.

Three things about this repo shape every decision here:

- **The card-source resolution ladder already has the branch we need, and it is unreachable.** `openCardSource` (`src/utils/cardSourceNavigation.ts:519-528`) contains an explicit "no locator at all → open the document at its stored reading position" path. It can only run when `resolution.documentId` is set, and `documentId` is only ever set by rungs that have *already located something*. A card with a bare `document_id` falls to the `no-source` return at `:503` without that field ever being read. This is a missing branch, not a missing feature.
- **The SponsorBlock settings shape is already written — in a type the runtime never loaded.** `src/types/settings.ts:342-359` has the full `SponsorBlockSettings` interface, `src/config/defaultSettings.ts:251-267` has defaults, `src/utils/settingsValidation.ts:311-327` has a zod schema. The live store's `Settings` (`src/stores/settingsStore.ts:964-991`, 26 categories) has no such key, and `rg "settings.sponsorBlock|sponsorBlock\."` returns zero runtime reads. The shape is not a design question; only the destination is.
- **Tailwind v4 is CSS-first here** — no `tailwind.config`, and `src/index.css` defines no `--breakpoint-*`. Any `xs:`-prefixed utility is not a generated variant, which is why the phone queue's three view-switcher labels (`hidden xs:inline`) are `display: none` at every width rather than only narrow ones.

## Goals / Non-Goals

**Goals:**

- Make the existing document-start branch reachable, and keep resolution local and bounded.
- One definition of "this card has a reachable source", consumed by every surface that offers it.
- Give Schedule a labelled way out on every shell, and stop the date-filter icon from being mistaken for one.
- Make the SponsorBlock shape already in the repo the one the runtime reads, gate both the request and the seek, and add the timeout and cache the module never had.
- Make every queue overlay viewport-relative, and stop gesture rows from resting off-screen.
- Remove the code that misleads the next reader: the orphaned SponsorBlock component, the dead legacy "Source jump" button, and the undefined utility classes.

**Non-Goals:**

- Re-anchoring a card's source after creation. That needs a write path (`update_learning_item` does not persist `source_reference`), a pick-a-location UI, and a sync field-group entry — none of which the reported bug requires once the click navigates.
- Retro-fitting `source_reference` onto cards already in the database. The new rung makes those cards work without it.
- Making the SponsorBlock category setting govern **download pre-cutting**. That is a separate Rust path (`src-tauri/src/sponsorblock.rs:116-181`) with its own fixed category set; see Open Questions.
- Restructuring the settings store. One new category, one version bump.
- Any change to the desktop data grid, the agenda, the workload band, or the scheduler.

## Decisions

**The bare `document_id` becomes rung 4 of the ladder, not a branch in the UI.**

`resolveCardSource` gains a final step: if no earlier rung produced anything and `item.document_id` is present, verify the document still exists via the existing `findDocument` helper, and return a `coarse` resolution carrying that id and no location. `openCardSource`'s existing branch then opens the document. Nothing new is written for navigation — the code is already correct and merely unreachable.

*Alternative considered:* catch `reason: "no-source"` in `CardSourceContext.handleActivate` and open the document there. Rejected — that patches one of four call sites (`CardSourceContext`, `CardContextMenu`, `ZenReviewMode`'s Alt-peek, the `V` key handler), leaves resolution semantics split between a util and a component, and would still have to be replicated per platform.

**`document-missing` and `no-source` get separate copy; "the original document no longer exists" is reserved for `document-missing`.**

The complaint is not that the panel exists, it is that the panel lies. A deleted document and a card with no recorded source are different facts and need different sentences. The `stale` case (excerpt no longer in the document) already has its own string and already navigates; it needs no change, only the guarantee that it keeps navigating.

*Alternative considered:* one generic "source unavailable" for all three. Rejected — that is the status quo and is precisely the reported defect.

**Source availability is one predicate, next to the types, not a component-local boolean.**

`CardContextMenu.tsx:121` gates on `extract_id || source_reference` and ignores `document_id`, which is why a whole-document card shows the button in the strip and nothing in the menu. The Rust command `get_card_source_context` already uses the correct rule (`document_id` present ⇒ context exists), so the predicate mirrors that. Exporting it beside `CardSourceProbe` makes it importable by the strip, the menu, and the keyboard registration without any of them re-deriving it.

*Alternative considered:* have each surface call `get_card_source_context` and branch on the result. Rejected — an async call to decide whether to render a button, in three places, for data the card row already carries synchronously.

**No write path. The rung is enough.**

Once the click navigates, the user's stated problem is solved. A repair affordance is a separate capability with a database-facing surface, and the same click would have two possible meanings. Out of scope, deliberately.

**The phone view-switcher labels become unconditional; an `xs` breakpoint is not defined.**

Three segments reading "Reading / Schedule / Review" fit a 360 px bar; they were hidden because of a class that does not compile to anything. Removing the wrapper is correct at every width. *Alternative considered:* add `--breakpoint-xs: 400px` to make `xs:` real. Rejected — it makes the current markup work but leaves an undocumented magic breakpoint in the design system, and the same mistake is already latent at `scrollbar-hide` and `pb-safe`. Better to fix the three call sites and consider a lint guard separately.

**The Schedule workspace header gets its own back control, and it is not the date `X`.**

`ScheduleWorkspaceHeader.tsx:88` has exactly one icon and it clears the date filter. The spec requires the two to be distinguishable and requires that clearing the date not leave the workspace. Back returns the queue to its **default** mode rather than the last-used one: the queue's `reading` mode is the landing surface, and restoring a remembered `review` mode would drop the user somewhere they did not choose. Desktop keeps its existing Reading/Schedule/Review control row; the back control is additive and shares the same handler.

**The session queue list becomes a viewport-anchored sheet on phone; it stays an anchored dropdown on desktop.**

`ReviewSession.tsx:936-938` is `absolute right-0 mt-2 w-80` inside a `relative` wrapper that is the last child of a `flex-wrap justify-start` row (`:863`) after five preceding controls. On a phone that wrapper can sit near x≈0, and a fixed 320 px panel right-anchored to it lands almost entirely at negative x, under `z-50` and invisible. The branch follows `FSRSInspector.tsx:259-267`, which already implements the house pattern for exactly this situation: `fixed right-0 top-0 bottom-0 w-80` with safe-area padding and a scrim. The existing outside-click close (`:503-525`) is kept; Escape is added to match.

*Alternative considered:* clamp the existing panel with `w-[min(20rem,calc(100vw-2rem))]`. Cheaper and it does stop the overflow, but a 320 px card still lands awkwardly mid-screen with its toggle behind it, and the panel is a scrollable list that reads better as a sheet.

**`useSwipeGestures` is repaired at the closure, because the snap-back animation is cancelling itself.**

This is the actual cause of rows resting off-screen, and it is not a clamping problem. `handleTouchEnd` closes over `state` (`:214`), so every `setState` recreates it, which re-runs the binding effect (`:236`), whose cleanup calls `cancelAnimationFrame(rafRef.current)` (`:233`). The snap-back's `animate` (`:181`) calls `setState` on its first frame, so the second React commit cancels the very rAF the first frame scheduled (`:190`). Net effect: the row freezes at `startOffsetX` — the full drag offset — with `isDragging: true` and no way out but a new `touchstart`. `handleTouchMove` closes over `state.isDragging` (`:149`) and is likewise rebound on every move, so the first move of a gesture is dropped and four listeners are torn down and re-added per move.

The fix is to hold gesture state in refs and read it through them, keeping the effect's dependency list stable; the snap-back keeps its rAF id in the ref the cleanup owns. *Alternative considered:* clamp `offsetX` in `SwipeableItem` to keep the row on screen. Rejected — that hides the freeze without fixing it; the row would still stall mid-drag and `isDragging` would stay stuck. The clamp is worth doing too, but as a separate, smaller concern.

**A separate clamp caps the live drag offset at the action-reveal width.**

`offsetX: dx` (`:137`) is the raw finger delta. Capping it to the width of the revealed actions means a fast flick cannot paint the row hundreds of pixels off-screen mid-drag even before the snap-back runs. This is cheap and independent of the closure fix.

**SponsorBlock settings become a new top-level `sponsorBlock` category in the live store, surfaced as a section in the existing Integrations tab.**

Top-level rather than nested under `youtube`, because `LocalVideoPlayer` and `AudiobookViewer` run the same loop. A section in `IntegrationSettings.tsx` rather than a new `SettingsTab`, because that file already renders one `<h3>` block per third-party service (Obsidian, Anki, browser-extension server, YouTube auth cookies, YouTube transcripts) and SponsorBlock is exactly that kind of thing — inventing a tab would be more ceremony for the same UI. The interface is lifted verbatim from `types/settings.ts:342`; the parallel `Settings` type, its `defaultSettings`, and its zod `SponsorBlockSettingsSchema` lose their SponsorBlock parts rather than being kept in sync, because keeping two Settings worlds in sync is the defect.

Persist `version` goes 13 → 14 with a migration step, following the v7→v8 precedent at `settingsStore.ts:1507-1516`. The panel follows the `RSSSettings.tsx:44-53` pattern — `updateSettingsCategory` plus a `defaultSettings` fallback — and uses `src/components/common/Switch.tsx`, the documented house toggle. Note for the implementer: `updateSettingsCategory` shallow-merges one level, so the nested `categories` object must be replaced wholesale by the caller, not merged key-by-key.

**Both the request and the seek are gated, and the gate is at the request.**

`enabled: false` must skip `fetchSponsorBlockSegments` (`YouTubeViewer.tsx:534-543`) as well as the skip loop (`:790-866`). Gating only the loop would still send the user's video id to a third party on every play — which is what `privacyMode` is nominally there to prevent — and would still spend a request. `autoSkip: false` gates the seek while leaving the fetch and the status indicator intact, so the user can see that segments exist without being moved.

**A single cached, bounded fetch in front of all three players.**

`src/api/sponsorblock.ts` is the only network path for segments in all three players, so the timeout and cache belong there rather than in each component: `AbortSignal.timeout(...)` to match `src/api/youtube.ts:239`, an in-memory map keyed by video id with a TTL from settings, a bounded entry count, and one in-flight promise per id so three components mounting at once cannot produce three requests. A failed or empty result is cached for the session rather than retried, which is what the spec's "no repeated request" scenario requires.

*Alternative considered:* add a Rust `reqwest` command for segments, reusing the existing `Lazy<reqwest::Client>` pattern. Better for the webview, but it would need a browser-mode mirror in `src/lib/browser-backend.ts` to keep the web build working — that is the `getSponsorBlockCuts` mistake, which works only because it guards on `isTauri()`. The frontend path is the one already shipping.

**`SponsorBlockIntegration.tsx` is deleted, not wired.**

342 lines with zero importers, a `useSponsorBlock` hook that would be a fourth copy of the skip loop, and its own settings checkbox is a comment-only stub (`:266-270`). Its per-category badges and vote buttons duplicate what the notification overlay already does. Wiring it would mean four implementations of the same behaviour.

**The desktop queue scroller gets `min-w-0`; the zen dot row gets bounded.**

`ReviewQueueView.tsx:1276` is `flex-1` with no `min-w-0` beside an always-open `w-80` inspector (`:1926`, default `true` at `:185`), so the list cannot shrink below min-content. The zen dot row (`ZenReviewMode.tsx:703`) is `fixed right-4` with ~156 px of content and nothing to stop it growing leftward as a session gets longer. `flex-wrap` plus a `max-w` keeps 20 markers countable instead of silently clipping them.

## Risks / Trade-offs

- **Adding a ladder rung changes which cards highlight** → the existing `cardSourceNavigation.test.ts` suite covers rungs 1–3 and the `no-source` return; extend it with a bare-`document_id` case and keep the `no-source` assertion for a card with nothing at all, so the two paths cannot collapse into each other.
- **SponsorBlock `enabled` defaults to `true`**, matching today's ungated behaviour, so no existing user sees a change on upgrade — including users who believed it was off. That is deliberate: the alternative silently starts skipping for people who opted out of nothing.
- **A settings version bump touches every user's persisted blob** → the migration fills SponsorBlock defaults whenever the key is absent, and `migratedGetItem` already covers a corrupt blob. A missing key must not break the whole store load.
- **Repairing `useSwipeGestures` touches every phone queue row** — it is the hook behind `SwipeableItem`, which wraps every `QueueRow`. The closure refactor is behaviour-preserving for the happy path, but it is the highest-risk edit in this change. Mitigation: cover the rAF lifecycle in a unit test (schedule, do not cancel, reset lands on zero), and exercise swipe-to-suspend and swipe-to-delete on a real device before calling it done.
- **Turning the queue list into a sheet on phone changes stacking and dismissal** → gate the branch on the same `isMobile` signal `QueueTab` uses, keep the outside-click close, and add Escape; verify it does not regress the desktop dropdown.
- **Unconditional switcher labels on a 320 px viewport** → give the label `min-w-0 truncate` and keep the 44 px targets rather than shrinking the type.
- **The category setting governs playback only, while Rust pre-cutting uses a fixed category set** → the panel must say so in its copy, or the app will read as inconsistent. Threading categories into the pre-cut path is a separate change.
- **`submitSegment` / `voteOnSegment` stay unreferenced** after the doubled-`/api` URL is fixed, and no UI calls them → they remain dead surface. Acceptable, because the URLs are plainly wrong and fixing them costs one line each; deleting them instead is defensible and is left as an implementer's call.
- **Four loosely related areas in one change** → tasks are grouped per area and each group is independently landable. Nothing forces a single big merge, matching the precedent set by `fix-outstanding-reported-bugs`.
- **Cleaning up the dead legacy "Source jump" button touches a second review surface** → it is a `dispatchEvent` for `plethora:source-jump` with no listener anywhere in the repo, gated on a `source_anchor` field the Rust model never populates, plus a `source_anchor?` type in `src/api/review.ts:321-327` that is never written. Removal is a pure deletion, but it is a deletion from a route file, so it is its own task.

## Migration Plan

No database migration. The new setting lives in the zustand/localStorage store alongside every other user setting; the learning-item shape is untouched (which is only possible because there is no write path); the SponsorBlock pre-cut metadata path is unchanged apart from a data-directory constant.

Deploy order is independent per area; the ladder fix and the message copy ship together because separating them would ship the new message against the old navigation. Rollback is per group.

## Open Questions

- Should download pre-cutting honour the category setting? Deferrable — the specs scope the setting to playback skipping, and answering it does not change this change's approach.
- Should SponsorBlock submission and voting get a UI, or should those two functions be deleted as unused? Deferrable — the settings work does not depend on the answer, and the doubled-`/api` fix is correct either way.
- Should a lint rule be added to reject unknown Tailwind utility prefixes such as `xs:`? Valuable and cheap, but it is tooling rather than behaviour and has no bearing on these specs.
