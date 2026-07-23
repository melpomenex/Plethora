### Fixed & Improved

- **Removed global left-swipe navigation on mobile** — The app-wide left-swipe gesture was intercepting swipes meant for in-content interactions, making swipeable surfaces feel stuck or janky. The global handler (and its `useEdgeSwipeForward` / `useSwipeBetweenTabs` siblings) is gone; page-local swipe handlers now own their gestures uncontested, and edge-swipe back is scoped to its own hook.
- **Mobile Queue extracts scroll correctly** — The Queue's extract list was unscrollable on touch devices because the extracts view wasn't claiming the scroll container it needed. `QueueExtractsView` now sizes itself to fill the viewport and scrolls independently of the surrounding Queue chrome.
- **Re-enabled animated themes** — Animated themes were inadvertently disabled, leaving the theme picker static. They're active again, with the backdrop animation and per-theme motion restored while the static-theme fallback is unaffected.
