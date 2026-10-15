## Context

See proposal.md for the reported overlap. The mobile shell gives its main content an area above the fixed bottom navigation, but both completion entry points currently render their summaries in fixed-height, non-scrollable wrappers. The ReviewSession path also places a separate return-to-review button after the shared summary, making it the last item that must remain reachable.

The shared `--shell-mobile-nav-height` includes the mobile navigation and bottom safe-area inset. The completion screen should use the existing shell boundary rather than adding that full height a second time inside the content.

## Goals / Non-Goals

**Goals:**
- Make long completion content scroll within the available app content area.
- Keep the final action reachable in both completion entry points.
- Preserve the current centered presentation when all content fits.

**Non-Goals:**
- Change completion content, review actions, or navigation behavior.
- Change sizing or placement of the app-wide bottom navigation.

## Decisions

### Make each completion wrapper the vertical scroll boundary

Add a constrained vertical scroll container at the completion state in `ReviewSession.tsx` and `routes/review.tsx`. Use a full-height inner layout that can center short content while allowing tall content to start at the top and scroll to the bottom. Keep a modest end gutter so the last button does not touch the edge of the content viewport.

The mobile shell already ends the main content above the fixed navigation and includes the safe-area inset in its height token. Reuse that shell sizing instead of adding another navigation-height inset to the completion content, which would create excess blank space. Keep scroll handling within the completion branch so active-card layouts are unaffected.

Alternative considered: add bottom padding only to `ReviewComplete`. Rejected because the ReviewSession path renders its final “Back to Review Home” action outside that component, so component-local padding would not protect the last action.

### Keep both completion entry points aligned

Apply the same scroll and end-spacing behavior to the ReviewSession completion branch and the review route's completion branch. The former includes an additional return action; the latter renders only the shared summary. Avoid changing `ReviewComplete` content or desktop navigation semantics.

Alternative considered: update only the screen shown in the screenshot. Rejected because the route completion path shares the same fixed-height wrapper pattern and should obey the same mobile viewport contract.

## Risks / Trade-offs

- [Risk] Centering tall content can leave the beginning clipped when a flex container overflows in both directions. → Mitigation: make the outer completion boundary scrollable and let the inner full-height layout center only when content fits.
- [Risk] Adding the navigation height again as inner padding can leave a large blank tail. → Mitigation: rely on the mobile shell's existing content height and reserve only a small visual gutter at the scroll end.

## Migration Plan

No data migration is needed. Apply the layout change to both completion wrappers and add a regression check at a short phone viewport with bottom navigation enabled. Revert the wrapper changes to roll back.
