## Context

See `proposal.md` for the reported mobile problem. The source strip is rendered by `ReviewCard.tsx:750` inside the padded question area. In `CardSourceContext.tsx:113-168`, the title disclosure is a `flex-1` button beside a non-shrinking navigation button. The inner title has `truncate`, but the disclosure has no explicit `min-width: 0`; its intrinsic content can therefore prevent the intended shrink/truncation. The external URL is also an anchor inside that button. This is a source-level diagnosis supported by the screenshot, not a browser reproduction of the current checkout.

The current title segment toggles the excerpt, while the adjacent action uses `openCardSource` with `reviewReturn: true`. The related `add-flashcard-source-navigation` proposal already intends the title strip to act as the source action. Keep the existing resolution and return machinery; clarify the two interactions locally.

The interface is React/CSS inside the mobile WebView and browser. Use container width and existing responsive rules, not device detection. Preserve the active theme, typography, borders, and semantic colors from `DESIGN.md`.

## Goals / Non-Goals

**Goals:**

- Give the title a reliable shrink boundary and useful reading space, including in a narrow desktop pane.
- Make navigation, disclosure, and an optional external link independent, accessible actions.
- Keep the full title accessible even when there is no extract snippet, without requiring runtime text measurement.

**Non-Goals:**

- Rework source provenance, backend resolution, reader highlighting, review scheduling, or other review surfaces.
- Add a modal, tooltip dependency, scrolling title marquee, or global CSS overflow workaround.

## Decisions

### 1. Bound the layout at the source strip and every flexible text boundary

Make the strip and title-bearing layout shrinkable within the card (`min-w-0`, a width bounded by the parent, and equivalent grid/flex constraints). Give the text column the remaining space; keep the source and navigation icons non-shrinking. If an ancestor still imposes a content minimum, fix only the nearest relevant ancestor in `ReviewCard`.

Use wrapping with `overflow-wrap: anywhere` for long unbroken text. Restrict line clipping to the compact title text. Expanded text, secondary links, unavailable notices, and excerpts also wrap within the same boundary. Do not hide overflow on the page or entire source strip: that could conceal controls or focus rings without correcting sizing.

Alternative: adding `overflow-hidden` alone can conceal the symptom while leaving unreachable content. A fixed pixel width fails in different card/pane sizes.

### 2. Make the broad title area the passage action

Use one primary button containing the book icon, localized `From:` context, the document title, and a visible navigation arrow. A page marker, when present, sits on a separate metadata line outside the clamped title. The title can wrap to two lines on compact layouts; excess text ends with an ellipsis. Keep the existing font size and allow the control to grow vertically; do not shrink type to fit.

The primary button invokes the existing `onActivate(itemId)` override or the existing default navigation handler. Preserve loading/disabled behavior, the full document title in the accessible action name, focus treatment, and the desktop `V` shortcut. Repeated activation while the default action is resolving must remain guarded. Desktop can retain its visible view-source label and shortcut hint when space permits, with the same containment behavior in narrow panes.

Alternative: retaining the current title-as-preview behavior leaves a large misleading tap target beside the real passage action. An icon-only primary action is harder to discover on touch.

### 3. Use inline source details for complete text and secondary information

Place a separate localized `Source details` disclosure after the primary action in document order, on its own compact row at phone widths. Give it an explicit expanded state and controlled-panel association. Make it available for every displayed source, even without a snippet; this avoids DOM measurement and ensures a clamped title always has a touch-accessible full-text path.

The expanded panel shows the full wrapping title, any page marker, the existing excerpt as inert text when available, and the external source link when present. The link is a sibling of buttons, keeps its existing external-opening safety attributes, and never activates the passage action. Unavailable-source feedback must not suppress full-title access. Expansion is local to the card and resets on item changes as it does today.

This adds a small secondary row on phones in exchange for giving the title the entire primary row. It avoids squeezing multiple small actions alongside a long title. A hover-only `title` tooltip or long-press gesture would not provide dependable touch access; unrestricted collapsed wrapping could let pathological titles dominate the study view.

### 4. Preserve the existing control and theme contracts

Use existing semantic theme and focus tokens. Interactive targets meet `DESIGN.md`'s 40px minimum and 48px minimum on coarse pointers, with separated hit areas. Keep icon cues and visible focus so meaning does not depend on color or hover. Add new labels through the existing locale system, including explicit disclosure naming; do not add typography or colors specific to the screenshot's theme.

### 5. Verify behavior separately from browser geometry

Extend `CardSourceContext.test.tsx` for title activation, the callback override, independent details expansion with and without a snippet, full accessible names, sibling external links, and existing loading/error outcomes. Assertions should verify behavior and semantics rather than a particular Tailwind class list.

Use a minimal real-component visual harness with mocked data/navigation and a padded review-card wrapper. Playwright geometry checks must cover 320, 360, 390, and 430 CSS-pixel phone widths, phone landscape, a tablet, desktop, and a narrow desktop pane. Include the screenshot title, a short title, a very long unbroken title, a page marker, and a URL; test details expanded/collapsed and enlarged text at 200%.

Assert strip/control bounds against the card's content box and viewport, no horizontal scroll introduced by this component, and visible hittable targets. Check painted title clipping/ellipsis and focus rings in screenshots, since text can escape even when element rectangles fit. Unit-test DOMs cannot establish layout containment. Browser input simulation is not physical-device evidence; record any unavailable iOS/Android WebView checks explicitly.

## Risks / Trade-offs

- **Title taps now navigate instead of expanding excerpts** → Label the independent disclosure clearly, preserve excerpt access, and update the interaction tests. This aligns the title with the user's stated action and the existing navigation proposal.
- **Two-line titles still abbreviate similar long names** → Full title is available through ordinary touch disclosure and the primary accessible name, with the page marker kept separate.
- **Large text or long tokens can overflow expanded details** → Permit vertical growth and anywhere wrapping across all source text; verify 200% text size and actual browser geometry.
- **Other work touches the same component/locales** → Keep changes local and reconcile the existing source-navigation/source-context proposals against the checkout before implementation.

## Migration Plan

No data migration or new dependency is required. Ship the component, localized labels, and focused verification together. Rollback restores the prior component presentation and translations; source data and study state require no conversion.
