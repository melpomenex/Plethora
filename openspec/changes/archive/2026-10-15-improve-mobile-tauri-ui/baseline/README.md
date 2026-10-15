# Responsive UI Baseline

Captured before implementation on 2026-07-10 from the browser-backed local app with an empty library.

## Viewports

- `phone-portrait`: 390×844
- `phone-landscape`: 844×390
- `tablet-portrait`: 820×1180
- `compact-desktop`: 760×560
- `desktop`: 1280×800

## Surfaces

Each surface has one PNG per viewport (40 screenshots total):

- Dashboard
- Queue
- Review
- Documents
- Reader entry / Continue Reading empty state
- Analytics
- Search / Import command surface
- Settings

## Interaction Notes

- The current classifier treats every browser viewport below 1024px as the mobile shell. At 760×560 this removes the desktop tab/toolbar workspace instead of providing a compact desktop arrangement.
- The phone Queue view occupies only a narrow left portion of the portrait viewport while the remainder is blank, indicating an inherited width or scaling constraint.
- Dashboard, Documents, Analytics, Settings, and the reader entry generally fill the phone viewport, but bottom navigation overlaps the visual end of content unless each screen supplies its own padding.
- Mobile navigation exposes six items (five primary destinations plus More). Secondary destinations and Search are available from the More sheet, but an active secondary destination is represented only by the More item rather than its name.
- The desktop Queue packs many actions and filters into a single header band; it overflows conceptually before the window reaches compact desktop widths.
- Documents switches to a mobile-specific header and two-column skeleton grid. The inspector is hidden, but toolbar state and action priority differ substantially from the desktop screen.
- Settings uses a dedicated mobile category list and a two-pane desktop layout; crossing the existing breakpoint replaces the presentation rather than sharing a stable shell primitive.
- Analytics shows raw empty-data defects (`undefined`, `NaN`) in addition to a very long single-column mobile page. Those data issues are pre-existing and outside this layout change except where accessible fallbacks are added.
- Search is reachable from More on constrained viewports and from Command Palette on desktop. The Import URL dialog opened on desktop is unmounted when the shell crosses into mobile mode, demonstrating state loss during presentation changes.
- No document was available in the baseline profile, so the reader capture covers the Continue Reading entry/empty state. Viewer-specific baselines will be added by the reader regression fixtures later in this change.

## Naming

Files follow `<surface>-<viewport>.png`, for example `queue-phone-portrait.png` and `settings-compact-desktop.png`.
