## Context

The mobile shell installs global touch listeners from `MobileLayoutWrapper`. The intended ownership split after this change is:

- `useEdgeSwipeBack` owns an inward gesture that starts at the left edge and requests application back navigation.
- View-level controls and scroll surfaces own all other gestures, including horizontal Library scrolling.

The back action ultimately flows through `requestApplicationBack`, which dismisses overlays or contextual state before moving through tab history. The previous full-width tab-cycling and right-edge-forward listeners could interpret a Library swipe as navigation away from the current view. The implementation must leave every non-edge horizontal touch entirely to the active view; the only remaining global horizontal navigation gesture is the intentional left-edge back gesture.

## Goals / Non-Goals

**Goals:**

- Make the left-edge origin a hard prerequisite for mobile back recognition.
- Ensure a touch that starts outside the edge activation zone can never trigger back, even if it later travels horizontally or crosses into the edge zone.
- Remove global horizontal tab navigation so Library and other content surfaces retain horizontal scrolling/swiping.
- Keep existing control and gesture-exclusion behavior intact.
- Provide deterministic unit coverage for the gesture boundary and manual verification on native mobile builds.

**Non-Goals:**

- Changing tab history semantics, overlay dismissal order, or `requestApplicationBack`.
- Replacing the platform's native back gesture or adding a new dependency.
- Redesigning Library scrolling.
- Adding visual gesture affordances.

## Decisions

### Gate ownership at touch start

The recognizer will record a single-touch sequence only when its initial `clientX` is within the configured left-edge activation width (defaulting to the existing small edge band, 24 CSS pixels). A touch that starts outside that band is marked untracked for the complete sequence; later movement cannot make it eligible.

This is preferred over checking the current pointer position on `touchend`, because end-position checks allow ordinary in-content swipes to be misclassified. It also keeps the rule independent of which child element receives subsequent touch events.

### Require an intentional inward horizontal gesture

For an edge-origin sequence, recognition remains subject to single-touch input, horizontal intent, inward travel, and the existing minimum distance. Vertical-dominant movement, outward movement, cancellation, multi-touch, and short drags do not request back. `preventDefault` is applied only after horizontal intent and inward direction are established, so ordinary vertical scrolling is not blocked.

This preserves the existing interaction contract while making the edge boundary explicit. A CSS-only solution such as `touch-action` cannot express the required distinction between an edge-origin gesture and a mid-screen gesture that uses the same direction.

### Remove global horizontal tab navigation

The mobile wrapper will no longer register `useSwipeBetweenTabs` or `useEdgeSwipeForward`. No full-width or right-edge leftward swipe will change tabs; the edge-back hook remains the sole global horizontal gesture path to application back. The bottom navigation remains available for intentional tab changes.

Removing the competing handlers is preferred over adding more target-specific exclusions because it protects every current and future scroll surface, including Library content that may not have a stable semantic class.

### Test behavior at the hook boundary

Vitest tests for `useEdgeSwipeBack` will assert both sides of the contract: a qualifying left-edge inward swipe invokes the callback, while a matching horizontal swipe that starts in the screen body does not. Additional cases cover vertical movement, insufficient distance, wrong direction, multi-touch/cancel, and protected targets. Manual native-mobile verification will exercise Library scrolling because browser-style synthetic touch tests cannot prove the webview's scroll behavior.

## Risks / Trade-offs

- [Risk] A very narrow edge band can make back difficult to invoke on some devices. → [Mitigation] Keep the width configurable and retain the current small default; validate on representative iOS and Android devices before adjusting it.
- [Risk] A horizontal edge gesture may compete with the OS/webview's own navigation gesture. → [Mitigation] Prevent default only after horizontal inward intent is established and verify behavior in the native builds.
- [Risk] A duplicate listener could reintroduce the bug even if the hook itself is correct. → [Mitigation] Audit all `requestApplicationBack` gesture call sites and add a non-edge regression case at the global handler boundary.
- [Risk] Users lose horizontal tab cycling and right-edge forward navigation. → [Mitigation] Keep the bottom navigation and explicit back controls available for intentional navigation.
- [Risk] Excluding too many targets could make back unavailable from useful edge areas. → [Mitigation] Preserve the existing exclusion list and limit changes to targets that demonstrably own a conflicting gesture.

## Migration Plan

No data or schema migration is required. Remove the competing global swipe handlers, keep the edge-back boundary and tests, verify Library horizontal scrolling and edge-back on native mobile, then ship as a behavior-only mobile fix. If validation exposes a platform-specific issue, revert the hook/wrapper change without affecting stored state or navigation history.

## Open Questions

- Confirm the final edge activation width on the target Android and iOS devices; the design assumes the existing 24 CSS-pixel default is a suitable starting point.
