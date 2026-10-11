## 1. Document Refresh Integration

- [x] 1.1 Mount the shared pull-to-refresh interaction at the live mobile document-view boundary and connect it to each active reader scroll surface, including embedded reader content where needed; verify pulls only start at the active surface's top and normal scrolling and text selection still work.
- [x] 1.2 Replace the document helper's timer-only fallback with the active document refresh operation and propagate refresh failures; verify successful hydration updates the displayed document and a failed or missing refresh reaches the failure state.
- [x] 1.3 Adapt the Queue refresh boundary to report the store's captured load error to the shared indicator; verify successful loads show success and failed loads show failure.

## 2. Shared Animation and Accessibility

- [x] 2.1 Implement the shared progress, armed, refreshing, success, and failure visuals in the pull-to-refresh component and mobile styles; verify the same progression appears in Queue and document views while content remains visible.
- [x] 2.2 Localize pull/status labels and support reduced-motion preferences; verify translated labels render and reduced motion retains clear state feedback with less movement.

## 3. Gesture and Surface Integration

- [x] 3.1 Preserve the existing one-per-gesture threshold event and scroll-position contracts; verify the threshold feedback occurs once per pull and Queue's virtualized list and document reader keep their scroll positions.
- [x] 3.2 Check the shared interaction on mobile Queue and supported document views from below-threshold pull through success and failure; verify no full-screen blocking overlay appears and the existing haptics behavior remains intact.
