## Context

See `proposal.md` for motivation. The supplied mobile screenshot shows the document/extract/card toolbar obscuring the priority trigger while its dropdown is open.

Verified implementation anchors:

- `src/components/queue/ScrollOverlayControls.tsx:374` renders an absolute top header with `16px + safe-area-inset-top` padding. The priority and Details triggers are in its right action group.
- The same file at line 539 renders the mode toolbar independently at `top-16`. This fixed offset does not account for the header's safe-area padding or actual height.
- Its local `ScrollPriorityControl` at line 670 owns the editor, saving state, presets, and slider. The similarly named `src/components/viewer/PriorityControl.tsx` is a separate control and is outside this change.
- `src/pages/QueueScrollPage.tsx:4911` supplies priority state/handlers and the Details trigger. It currently hides the priority's text on narrow screens through the local control's markup.
- `useRatingDockBounds.ts:12` measures `headerRef` to position rating controls. That measured region must include both upper rows after reflow.
- `ResponsiveDialogSheet.tsx` already portals to the document body and uses shared dialog focus/dismissal behavior. It has concurrent local edits; integrate with its current API rather than replacing or reverting them.

## Goals / Non-Goals

**Goals:** Give the mobile overlay one owner for upper-control layout; retain a visible, single-tap priority entry point; use existing adaptive dialog infrastructure for an accessible editor.

**Non-Goals:** Redesign the reader, bottom rating dock, Assistant, or desktop toolbar; change priority thresholds, preset values, scheduling, or overlay activation gestures; introduce a collision engine, navigation destination, preference, or new dependency.

## Decisions

### 1. Put mobile upper controls in normal flow inside one positioned region

Keep one safe-area-padded upper region anchored to the overlay frame. Within it, use a vertical flex/grid stack:

```text
safe-area inset
[Close] [3 / 50]          [flag Normal v] [Details icon]
[Document | Extracts | Cards] [Create extract]
```

The first row owns session actions and metadata; the second owns reader modes and extraction. Render the second row only for the item types that already support it. Keep desktop composition intact through the existing mobile branch/presentation conventions.

The priority chip displays its flag, current named level, and disclosure indicator on mobile. Its accessible name is localized as Reading Priority plus the current level; it exposes expanded state and its controlled editor. Details can use an icon-only compact trigger with an explicit accessible name. Preserve the existing mode icons, selected states, and functions.

Use 44px minimum touch targets and flexible gaps. If long translations, a large queue count, a neural banner, or enlarged text prevent the first row fitting, allow groups to wrap within the upper stack; retain the priority name and actions rather than clipping them or reducing hit areas. Keep DOM and visual order aligned. Apply safe top/left/right insets once, and constrain the region to the visible viewport. `headerRef` surrounds the entire stack so existing rating-dock geometry clears every upper control, including a wrapped row.

Alternatives considered: raising z-index merely changes which action is covered; a larger `top` offset still fails with insets and text scaling; putting priority in Details or an overflow menu adds discovery and interaction costs; adding it to the bottom dock creates competition with ratings and the Assistant.

### 2. Use a mobile bottom sheet and retain the desktop popover

Pass the overlay's mobile presentation into the local priority control. On mobile, reuse `ResponsiveDialogSheet` with sheet presentation and a localized Reading Priority title; on desktop retain the anchored popover. Share one editor body and one save state between the two presentations so values and behavior cannot drift. Do not migrate the unrelated viewer priority control.

The mobile sheet uses opaque semantic surface/foreground roles, an explicit close action, and safe-bottom padding. Its order is title/status, five named presets, then Fine-tune with the exact percentage and a labeled range input. Use a visible selected marker and semantic selected state in addition to flag color. At narrow widths or with enlarged/localized labels, reflow presets into fewer columns or full-width options; do not squeeze all five into tiny targets or truncate their names. Keep controls at least 44px in each touch dimension. Bound height to the usable visual viewport and scroll the sheet body in short landscape layouts.

Reuse the shared focus trap, focus return, dismissal stack, and dialog layer tokens. The editor must paint above queue chrome, rating controls, Assistant launcher, and mobile navigation; its scrim blocks background interaction. Opening priority must not also activate an underlying mode or grade. Close button, backdrop, Escape, and supported system Back dismiss only the editor and return to the same reading position. Verify integration with the existing Assistant modal; maintain one active editing surface without changing Assistant behavior.

Alternative: a larger anchored mobile dropdown still competes with upper controls, has poor thumb reach, and is vulnerable to clipping and short viewports. A full-screen settings page loses reading context for a small contextual task.

### 3. Preserve saving behavior and bind the editor to the current item

Keep the current five preset values, 0–100 slider range, and priority update callback. A successful preset saves and closes; a failed save keeps the editor open, restores the last saved value, and exposes readable, announced error feedback. The slider previews locally and commits on interaction completion or keyboard editing completion, preserving the current fine-tune flow without adding a Save button. Closing the editor does not undo completed changes.

Key or explicitly reset the editor by queue-item identity, including extracts that share a document id. The current page exposes priority for documents and extracts (`QueueScrollPage.tsx:1830`); preserve that eligibility. Close it when the current item changes, priority becomes unavailable, the queue overlay intentionally hides, or the reader unmounts. A late save completion must not update or close an editor for a subsequent item. Serialize/disable conflicting commits while a request is pending; preserve slider keyboard operation and prevent duplicate completion/blur saves. Make saving and failure status accessible and localized through existing label plumbing.

Opening/interacting with the editor must leave the overlay visibility unchanged. Its scrim consumes dismissal taps so they cannot toggle the queue overlay or activate background controls. Existing stationary-tap, scroll, long-press, selection, and volume-key behavior remains governed by `queue-overlay-activation`.

## Risks / Trade-offs

- [Stacked controls use more vertical space] → Keep two compact rows at ordinary phone sizes, omit absent actions, wrap only when needed, and preserve the overlay's existing intentional hide behavior.
- [A taller header collides with top-docked rating controls] → Measure the full stack and verify all dock edges using the existing geometry hook.
- [Existing dialog primitives do not block every background interaction] → Verify real pointer hit testing and keyboard containment; apply the smallest scoped integration fix and avoid unrelated primitive redesign.
- [Changing items during asynchronous saving leaks stale state] → Bind editor lifetime to item identity and test deferred request resolution across item changes.
- [Concurrent changes in shared dialogs, Assistant, and rating geometry] → Reconcile against the working tree at implementation time and preserve their contracts. The proposal does not require those changes to be reverted or archived first.

## Migration Plan

Ship as a frontend layout and presentation update with no data migration or new setting. Validate component behavior and rendered layouts before release; revert the scoped header/editor changes to roll back without touching priority data. No performance baseline update is expected; run the repository benchmark/bundle gate during implementation and document any intentional performance change if one is necessary.
