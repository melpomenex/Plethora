## Context

Currently, multi-selection and bulk action toolbars are implemented independently across several surfaces in Plethora:
- `src/components/documents/DocumentsView.tsx`: Inline header container above document cards, with 7 action buttons in a rigid flex row.
- `src/components/queue/BulkActionBar.tsx`: Fixed bottom bar (`fixed bottom-6 left-1/2 -translate-x-1/2`) with 10 buttons that wrap into a multi-line box on mobile and collide with the mobile navigation bar.
- `src/components/review/ReviewQueueView.tsx`: Static top container with 3 buttons.
- `src/components/extracts/ExtractsList.tsx`: Sticky top container with 3 buttons.
- `src/components/review/DeckManager.tsx`: Inline toolbar strip with compact buttons.

On mobile viewports (e.g., phones with widths between 360px and 412px), static top bars clip off-screen when button count is high, and scroll out of the viewport as the user navigates long lists. In addition, floating bars without explicit mobile navigation offsets overlap the bottom navigation bar (`.mobile-bottom-nav`).

See `proposal.md` for background motivation and `specs/mobile-bulk-selection-bar/spec.md` for behavioral requirements.

## Goals / Non-Goals

**Goals:**
- Provide a unified, accessible component pattern (`ResponsiveBulkActionBar`) that renders bulk selection controls responsively.
- On mobile devices (`isMobileShell` / phone viewports):
  - Dock as a floating contextual action bar in the thumb zone above the mobile navigation bar (`bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))`).
  - Eliminate horizontal clipping: wrap actions in a single-row horizontally scrollable touch track (`overflow-x-auto no-scrollbar touch-pan-x flex-nowrap`) and provide an optional overflow (⋯) sheet for secondary actions via `MobileContextMenuSheet`.
  - Provide a compact selection summary badge with a direct one-tap dismiss button (✕).
  - Ensure accessible touch targets (at least 40×40px).
- On desktop viewports (`presentation: desktop`):
  - Preserve clean layout (inline header or floating toolbar) without mobile layout side-effects.

**Non-Goals:**
- Altering the backend API payloads or business logic of any bulk action (e.g. reprioritize, suspend, archive, delete, move collection).
- Modifying text selection popups or reader annotation toolbars.
- Overhauling selection models (such as Shift+Click range selection or keyboard shortcuts).

## Decisions

### Decision 1: Shared `ResponsiveBulkActionBar` Component
- **Choice**: Implement a reusable `ResponsiveBulkActionBar` component in `src/components/common/ResponsiveBulkActionBar.tsx`.
- **Rationale**: Multiple surfaces currently duplicate selection count labels, button layouts, and dismissal logic. A unified component encapsulates mobile shell detection (`useMobileShell`), viewport-aware positioning, horizontal touch scrolling, overflow sheet handling, and keyboard accessibility.
- **Alternatives Considered**:
  - *Patching each surface with custom inline Tailwind classes*: Highly error-prone; leads to inconsistent offsets, duplicate overflow logic, and recurring mobile regressions.

### Decision 2: Floating Bottom Toolbar on Mobile
- **Choice**: On mobile presentation (`isMobileShell` or `data-presentation="phone"`), dock the bulk action bar near the bottom of the screen, floating above the mobile navigation bar (`bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))`).
- **Rationale**: Placing action controls in the bottom thumb zone is the native ergonomic standard on iOS and Android (e.g., Photos, Mail, Files). Top-docked bars disappear as users scroll down long lists of documents or queue cards, leaving users disoriented about selection state.
- **Alternatives Considered**:
  - *Sticky top bar*: Wastes valuable top-screen real estate, collides with sticky search and filter headers, and requires uncomfortable reach to the top on tall phone screens.

### Decision 3: Single-Row Horizontal Scroll Track + Overflow Bottom Sheet
- **Choice**: Organize actions on mobile into:
  1. A sticky/fixed leading chip: Selection count + Dismiss (✕) button.
  2. A horizontally scrollable action row (`overflow-x-auto no-scrollbar touch-pan-x flex-nowrap`).
  3. For surfaces with many actions (e.g., DocumentsView with 7+ actions), provide an overflow button (⋯) that opens an action bottom sheet (`MobileContextMenuSheet`) containing all actions with full titles, icons, and descriptions.
- **Rationale**: Prevents awkward multi-line card wrapping that blocks half the screen, while guaranteeing that no action is clipped off-screen or rendered unreachable regardless of screen width or language localization length.
- **Alternatives Considered**:
  - *Multi-line wrapping (`flex-wrap`)*: Consumes up to 200px of vertical screen space on narrow phones, obscuring document cards.
  - *Icons only with no text*: Leads to ambiguous UX for complex operations like "Reprioritize" or "Move to Collection".

### Decision 4: Mobile Bottom Nav Offset Enforcement
- **Choice**: Add CSS rules in `src/styles/mobile.css` and utility classes in the component to anchor floating bulk action bars at `calc(4.5rem + env(safe-area-inset-bottom, 0px))` whenever the mobile bottom nav is active.
- **Rationale**: Consistent with other mobile floating components in Plethora (`.toast-container`, `.audio-review-pill`, `.clipboard-watcher-container`).

## Risks / Trade-offs

- **[Risk] Floating bottom bar covers the bottom-most list item during active selection**:
  - *Mitigation*: Ensure list containers have sufficient bottom scroll padding (e.g. `pb-28` or `SafeScrollContainer`) so that items at the end of the list can be scrolled fully into view.
- **[Risk] Desktop tests expecting specific DOM nesting in `DocumentsView`**:
  - *Mitigation*: Preserve action button labels, icons, roles, and test attributes. On desktop presentation, `ResponsiveBulkActionBar` renders cleanly within the view's layout container, ensuring existing selector tests continue to pass.
- **[Risk] Rapid toggling of selection causing layout jitter**:
  - *Mitigation*: Use smooth CSS enter/exit transitions (`animate-in fade-in slide-in-from-bottom-2 duration-150`) for the floating bar.
