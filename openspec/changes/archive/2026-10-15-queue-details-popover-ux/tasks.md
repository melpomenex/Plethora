## 1. Mobile Sheet Layout and Portal Architecture

- [x] 1.1 Integrate `useMobileShell()` into `ItemDetailsPopover` and render the mobile presentation via `createPortal(..., document.body)`, verifying that the popover mounts to the document body on mobile rather than inside the inline trigger wrapper.
- [x] 1.2 Add a full-screen dimmed scrim overlay (`fixed inset-0 bg-black/60 z-[9999]`) with a 300ms opening touch guard and tap-to-dismiss handler, verifying that tapping the backdrop closes the popover without accidental immediate dismissal.
- [x] 1.3 Implement body scroll locking while the mobile sheet is mounted and verify that `document.body.style.overflow` is safely restored on close or component unmount.

## 2. Scrollable Body and Persistent Header

- [x] 2.1 Refactor the sheet panel layout into a pinned header (`flex-shrink-0`) and a vertically scrollable body container (`flex-1 overflow-y-auto overscroll-contain`), constraining the sheet height to safe viewport boundaries (`max-h-[85vh]` or `max-h-[calc(100dvh-2rem)]`), and verify that the close button remains pinned at the top while body content scrolls.
- [x] 2.2 Add a mobile drag handle pill and safe-area inset bottom padding (`max(16px, env(safe-area-inset-bottom, 0px))`) to ensure bottom actions (Dismiss, Postpone, Delete) are not clipped or obscured.
- [x] 2.3 Apply desktop bounded height (`md:max-h-[calc(100vh-6rem)] md:flex md:flex-col`) with scrollable content to prevent popover overflow on small desktop or laptop viewports.

## 3. Testing and Verification

- [x] 3.1 Add or update unit tests in `src/components/common/__tests__/ItemDetailsPopover.test.tsx` verifying mobile bottom sheet portal rendering, backdrop scrim tap-to-dismiss, header close button interaction, and scroll container classes.
- [x] 3.2 Run test suite (`npm run test`) and type check (`npm run typecheck`) to ensure zero regressions across Queue scroll and review interfaces.
