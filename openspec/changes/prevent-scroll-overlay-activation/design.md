## Context

Queue Scroll Mode renders reading content beneath `ScrollOverlayControls`. On touch-capable devices, the content wrapper currently toggles `showControls` from a React `onClick` whenever the click target is not interactive. Browsers can synthesize a click after a touch sequence, so a finger gesture intended to scroll may also toggle the overlay. Volume-key scrolling follows a separate input path, but overlay activation is not currently governed by a single explicit input-intent rule.

The change must work across embedded document viewers, RSS content, transcripts, extracts, and other queue items without preventing their native scrolling, selection, paging, or interactive controls.

## Goals / Non-Goals

**Goals:**

- Reveal or hide Queue Scroll Mode controls only for a deliberate stationary tap on eligible content.
- Prevent touch scrolling, swiping, and volume-key scrolling from changing overlay visibility.
- Preserve native scrolling and the existing queue edge-navigation gestures.
- Omit the EPUB viewer's redundant bottom toolbar when it is embedded in Queue Scroll Mode.
- Reveal mobile rating actions only as a temporary long-press affordance.
- Make the behavior testable through a small, deterministic gesture-intent boundary.

**Non-Goals:**

- Redesigning the overlay, rating orbs, or queue navigation.
- Changing how far volume keys scroll the document.
- Changing mouse-only desktop overlay behavior.
- Reworking gestures owned internally by EPUB/PDF viewers beyond preventing accidental overlay activation.

## Decisions

### Classify touch intent before toggling controls

Track the initial touch/pointer coordinates and whether movement exceeds a small tap tolerance. Toggle controls only after the gesture ends within that tolerance and is not otherwise consumed. This expresses the product rule directly and avoids relying on a synthetic `click`, whose provenance does not reliably distinguish tapping from scrolling.

Alternative considered: debounce or delay the existing click handler. A timer can reduce flicker but cannot reliably determine whether the preceding input was a scroll, and it makes the UI feel slower.

### Share gesture observations with existing queue swipe handling

Use the same touch lifecycle, or a shared ref/helper observed by it, to classify the gesture without adding competing non-passive handlers. The classifier must not call `preventDefault`, so native document scrolling and the current edge-navigation logic remain intact.

Alternative considered: add an independent gesture library. That adds weight and risks conflicting gesture ownership for a narrow movement-threshold requirement.

### Keep overlay visibility unchanged for volume-key input

The volume-key handler will invoke only the content-scroll operation. It must neither call the overlay toggle nor synthesize a tap/click path. If volume input is bridged through a custom event, that event remains semantically distinct from overlay activation.

Alternative considered: hide the overlay whenever a volume key is pressed. That would also mutate interface state without a tap and could unexpectedly dismiss controls the user intentionally left visible.

### Exclude interactive and selection gestures

A qualifying stationary tap still does not toggle controls when it originates within buttons, links, form controls, or other marked interactive regions. A gesture used to create or retain a text selection is also excluded so reading tools are not disrupted.

### Suppress embedded EPUB bottom chrome

Remove the EPUB mobile bottom toolbar from both embedded and standalone reading. In Queue Mode, the Queue top bar exposes TOC, reading settings, and EPUB page-level previous/next actions through explicit events handled by the embedded viewer. In standalone reading, progress and the same actions live in the EPUB top bar. The redundant close-bottom-toolbar action is removed.

### Reveal rating actions with a long press

On mobile, keep the rating panel unmounted until an eligible touch remains within the stationary tolerance for 550 milliseconds. Movement, cancellation, interactive targets, or active text selection cancel the reveal. The panel hides again after a short timeout or when the queue item changes. Embedded EPUB content forwards the same intent through a parent-window event because iframe touches do not reach Queue Scroll Mode directly.

## Risks / Trade-offs

- [Small hand jitter could be classified as scrolling] → Use a modest movement tolerance and compare total displacement from the gesture origin, not just the last movement event.
- [Nested viewers may isolate touch events] → Preserve viewer-owned gestures; apply the rule wherever Queue Scroll Mode receives the gesture and verify representative embedded viewers separately.
- [Duplicate touch and synthetic click events could double-toggle] → Remove or gate the touch-device click toggle once touch-end classification owns mobile overlay activation.
- [Tests may lack real hardware volume events] → Test the application-level volume-scroll event/handler boundary and assert that overlay state remains unchanged.

## Migration Plan

No data migration is required. Ship the frontend interaction change and regression tests together. Rollback consists of reverting the gesture classifier and restoring the prior click toggle.

## Open Questions

None. Exact movement tolerance can be calibrated during implementation while preserving the normative distinction between a stationary tap and scrolling.
