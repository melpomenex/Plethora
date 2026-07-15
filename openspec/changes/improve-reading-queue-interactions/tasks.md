## 1. Shared Queue Order and Actions

- [x] 1.1 Add a shared pure helper for effective Reading Queue ordering and visible positions, applying active filters first and deterministic tie-breakers after the existing queue strategy ranking.
- [x] 1.2 Add unit coverage for mixed item types, filtered position recalculation, equal-ranked stability, and identifying the first item as up next.
- [x] 1.3 Implement a reusable queue-item action model/action sheet with contextual action availability, dialog semantics, focus return, Escape/backdrop dismissal, and an explicit actions-button entry point.
- [x] 1.4 Connect the action model to existing navigation, `postponeItemSmart`, suspend/dismiss, selection, refresh, toast, confirmation, and undo flows; hide mutations unsupported by an item type.

## 2. Mobile Reading Queue

- [x] 2.1 Render the mobile queue from the shared ordered list, including visible position/total labels and an up-next treatment for the first row.
- [x] 2.2 Ensure the mobile item list is the bounded vertical scroll region and preserve its existing scroll restoration plus item-ID anchor behavior after queue mutations.
- [x] 2.3 Change mobile long-press from immediate selection mode to opening the contextual action sheet, cancel the gesture when scrolling begins, and suppress the follow-up tap.
- [x] 2.4 Preserve bulk selection by exposing “Select for bulk actions” from the action sheet and keep swipe actions, ordinary taps, and selection-mode taps working as before.

## 3. Primary and Legacy Queue Surfaces

- [x] 3.1 Apply shared ordering and visible queue positions to `ReviewQueueView` while retaining its current strategy controls, selected-item browsing, and large-list virtualization.
- [x] 3.2 Add the shared action entry point to primary queue rows and preserve the existing desktop context menu and direct open/review actions as compatible fallbacks.
- [x] 3.3 Constrain the primary and legacy queue item lists to their available viewport, restore the nearest scroll anchor after refreshes, and verify filters/search do not create position gaps.
- [x] 3.4 Align the legacy queue route with the shared action availability and feedback behavior, or remove duplicate handling where the primary queue surface is now authoritative.

## 4. Localization and Accessibility

- [x] 4.1 Add localized strings for queue positions, up-next status, action-sheet titles, contextual actions, unsupported-action messaging, and action feedback using the existing locale bundle conventions.
- [x] 4.2 Verify row semantics, position announcements, action-button labels, dialog focus management, keyboard dismissal, and touch target sizing with the existing accessibility patterns.

## 5. Verification

- [x] 5.1 Add component tests for long-press completion, scroll cancellation, click suppression, explicit action-button opening, action availability by item type, and focus restoration.
- [x] 5.2 Add queue-surface tests for scrollable viewport behavior, mixed-item ordering, visible position labels, up-next treatment, and scroll-anchor preservation after removal/postponement.
- [x] 5.3 Run the relevant queue/store/component test suites and the project typecheck/build, then resolve regressions in existing queue, mobile, and virtualization coverage.
