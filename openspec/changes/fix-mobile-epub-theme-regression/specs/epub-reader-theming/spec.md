# Capability: epub-reader-theming

## ADDED Requirements

### Requirement: The EPUB reader derives its palette from the active Theme object

The EPUB reader SHALL resolve its reader palette (background, foreground/text,
primary/link, border, color-scheme, app font stack) from the active `Theme`
object provided by `ThemeContext`. Root `documentElement` CSS variables SHALL
be used only as fallbacks for tokens missing from the Theme object, and SHALL
never override a value present on the Theme object, regardless of whether the
parent theme effect has written the CSS variables yet. The same single
resolution implementation SHALL be used by every EPUB styling path (epub.js
rendition theme rules and the injected content override stylesheet).

#### Scenario: Dark Theme object wins over stale light CSS variables

- **WHEN** an EPUB is opened while `documentElement` CSS variables still hold
  light-theme values
- **AND** the active Theme object is dark
- **THEN** the EPUB content document SHALL be styled with the dark Theme
  object's background and foreground
- **AND** the light CSS-variable values SHALL NOT appear in the reader's
  injected styles

#### Scenario: Light theme applies light colors

- **WHEN** an EPUB is opened under an active light Theme object
- **THEN** the EPUB content document SHALL be styled with the light Theme
  object's background and foreground

#### Scenario: Missing optional theme tokens fall back without overriding

- **WHEN** the Theme object lacks an optional color token (for example
  `border`)
- **AND** a CSS variable exists for that token
- **THEN** the reader SHALL use the CSS variable value for that token only
- **AND** tokens present on the Theme object SHALL remain authoritative

### Requirement: The reader theme is installed on the rendition before initial content display

The EPUB viewer SHALL apply the reader theme to the concrete rendition
instance created by `renderTo()` — via the rendition instance itself or an
authoritative rendition reference, never via a React state value that has not
been updated — before the initial `display()` call. The epub.js theme rules
SHALL be registered and selected before any EPUB section becomes visible.

#### Scenario: Initial open applies theme before display

- **WHEN** an EPUB is opened
- **THEN** the rendition theme (`themes.default`/`themes.select`) SHALL be
  applied to the freshly created rendition before `rendition.display(...)` is
  invoked
- **AND** a React state/effect cycle SHALL NOT be required for that initial
  application

#### Scenario: Theme application does not depend on later state updates

- **WHEN** the initial rendition is created
- **AND** the React rendition state has not yet been committed
- **THEN** the theme SHALL still be applied to the rendition instance

### Requirement: Initial EPUB content is styled before it becomes visible

The initial EPUB content document SHALL receive Plethora's override styling
(background, foreground, font family, font size, line height, color-scheme,
link/border colors) before the reader container becomes visible. The viewer
SHALL keep the reader hidden until the initial content has been rendered and
verified themed; no arbitrary timeout SHALL be used as the primary readiness
mechanism.

#### Scenario: Dark theme initial open shows no white frame

- **WHEN** an EPUB is opened under a dark theme on mobile
- **THEN** the reader SHALL NOT display an un-themed white/browser-default
  frame at any point during initialization
- **AND** the first visible frame SHALL already carry the dark theme
  background and foreground

#### Scenario: Visibility is gated on themed content

- **WHEN** the EPUB book is ready and the rendition is created
- **AND** the initial content document has been rendered
- **AND** the reader theme has been installed and verified on that document
- **THEN** the reader container SHALL become visible
- **AND** the reader SHALL remain hidden while any of those conditions is
  unmet

### Requirement: EPUB content style replacement is failure-safe and preserves every theme layer

The EPUB viewer SHALL install its `#epub-override-styles` node and critical
inline styles on the content document before removing publisher styles, and
SHALL verify that the override node exists and reflects the active palette.
Publisher styles SHALL NOT be removed unless the Plethora override is
confirmed present in the same content document. The viewer SHALL preserve
epub.js's own theme nodes (`[id^="epubjs-inserted-css-"]`) and
`#epub-override-styles` during cleanup. If the override is missing or stale at
any lifecycle point (content hook, `rendered` event, theme change), the viewer
SHALL re-apply it.

#### Scenario: Publisher styles are removed only after the override exists

- **WHEN** a content document contains publisher `<link rel="stylesheet">`
  and `<style>` nodes
- **AND** the content hook runs
- **THEN** the `#epub-override-styles` node SHALL exist in that document
  before the publisher nodes are removed
- **AND** if the override node cannot be installed, the publisher nodes SHALL
  be retained

#### Scenario: epub.js's own theme layer survives cleanup

- **WHEN** a content document contains `style#epubjs-inserted-css-default`
  (epub.js's rendition-theme node) or any `[id^="epubjs-inserted-css-"]` node
- **AND** the content hook runs
- **THEN** those nodes SHALL remain in the document after cleanup
- **AND** publisher `<style>` nodes without that id prefix SHALL be removed

#### Scenario: Missing override is re-applied

- **WHEN** a mounted EPUB content document has no `#epub-override-styles` node
  or one whose rules do not reflect the active palette
- **THEN** the viewer SHALL re-apply the override with the active palette

#### Scenario: Styling never leaves browser defaults

- **WHEN** an EPUB content document is mounted or re-styled
- **THEN** the document SHALL carry either Plethora's override styling, the
  critical inline Plethora styles, or the publisher's own styling — never a
  state where all three are absent

### Requirement: Critical colors are applied directly to the content elements

For every EPUB content document, the viewer SHALL apply at least
`documentElement` `background-color` and `color`, and `body`
`background-color`, `color`, `font-family`, `font-size`, and `line-height`
directly via `HTMLElement.style.setProperty(..., "important")`, so the
reader's basic background/foreground correctness does not depend on any
single dynamically inserted `<style>` node.

#### Scenario: Inline critical styles are present after content processing

- **WHEN** an EPUB content document has been processed by the content hook
- **THEN** `documentElement` and `body` SHALL carry inline `background-color`
  and `color` matching the active Plethora palette
- **AND** `body` SHALL carry the reader font family, font size, and line
  height inline

#### Scenario: Inline critical styles update on theme change

- **WHEN** the app theme changes while an EPUB is open
- **THEN** the inline critical styles of every mounted content document SHALL
  be updated to the new palette

### Requirement: Initial visibility requires verified themed content

The reader container SHALL remain hidden until the initial content document
has been processed and its critical computed colors agree with the expected
Plethora reader palette: `getComputedStyle(documentElement).backgroundColor`,
`getComputedStyle(body).backgroundColor`, and `getComputedStyle(body).color`.
No arbitrary timeout SHALL be used as the primary readiness mechanism.

#### Scenario: Computed colors gate visibility

- **WHEN** the EPUB book is ready, the rendition is created, and the initial
  content document is rendered
- **AND** the content document's computed `html`/`body` background and `body`
  color match the active Plethora palette
- **THEN** the reader container SHALL become visible

#### Scenario: Unverified content keeps the reader hidden

- **WHEN** the initial content document's computed critical colors do not
  match the expected palette
- **THEN** the reader container SHALL remain hidden
- **AND** the viewer SHALL re-apply the Plethora styling to the content
  document

### Requirement: Theme changes restyle the open EPUB without recreation

When the active Plethora theme (or a reader typography setting) changes while
an EPUB is open, the viewer SHALL restyle all currently mounted content
documents with the new palette and typography without recreating the epub.js
Book or Rendition, without reloading the EPUB, and without losing the current
reading position (CFI) or highlights.

#### Scenario: Theme switch while reading

- **WHEN** the app theme changes from Theme A to Theme B while an EPUB is open
- **THEN** every currently mounted content document SHALL be re-styled with
  Theme B's palette
- **AND** the book and rendition instances SHALL remain the same
- **AND** the reading position and mounted highlights SHALL be preserved

#### Scenario: Typography change while reading

- **WHEN** the reader font size, line height, or font family changes while an
  EPUB is open
- **THEN** the mounted content documents SHALL be re-styled with the new
  typography values

### Requirement: Newly mounted EPUB sections receive the active theme

Every EPUB content document created after the initial display — additional
spine sections mounted by the continuous manager, chapter navigation,
pagination, and rendition resize — SHALL receive the same Plethora override
styling and epub.js theme as the initial section, using the same installation
mechanism.

#### Scenario: Second section after initial display

- **WHEN** a second spine section is mounted after the initial section has
  been themed
- **THEN** the second section's content document SHALL be styled with the
  active theme before it becomes readable
- **AND** its `#epub-override-styles` SHALL reflect the same palette

#### Scenario: Section mounted after a theme change

- **WHEN** the theme has changed
- **AND** a new spine section is then mounted
- **THEN** the new section SHALL be styled with the current (changed) theme,
  not the previous one

### Requirement: The EPUB reader is themed consistently across surfaces

The same theming behavior SHALL apply in the standalone Documents reader and
in the embedded EPUB reader / Queue Scroll Mode, on desktop, on the native
Android/mobile shell, and in the mobile PWA/browser where applicable. Desktop
behavior SHALL NOT regress.

#### Scenario: Standalone reader on mobile

- **WHEN** an EPUB is opened in the standalone document reader on mobile under
  a dark theme
- **THEN** the EPUB SHALL show the dark theme background and foreground

#### Scenario: Embedded Queue reader on mobile

- **WHEN** an EPUB is opened in the embedded Queue Scroll Mode reader on
  mobile under a dark theme
- **THEN** the EPUB SHALL show the dark theme background and foreground

#### Scenario: Desktop parity

- **WHEN** the same EPUB is opened on desktop under the same theme
- **THEN** the rendering SHALL match the mobile rendering for background,
  foreground, and typography

### Requirement: Reader typography settings are honored

The EPUB reader SHALL honor the reader font family selection (serif,
sans-serif, app-font inheritance, monospace), font size, and line height in
the injected override styling, on mobile and desktop alike.

#### Scenario: Serif, sans-serif, and monospace families

- **WHEN** the reader font family is set to `serif`, `sans-serif`, or
  `monospace`
- **THEN** the injected content styling SHALL apply the corresponding font
  stack
- **AND** the app font setting SHALL be inherited when the reader font family
  is the app default

#### Scenario: Font size and line height

- **WHEN** the reader font size and line height are configured
- **THEN** the content `body` SHALL be styled with those exact font size and
  line-height values

### Requirement: Standard mobile mode follows the app theme; E-Ink is distinct

Standard mobile reading SHALL follow the active Plethora theme. If an explicit
E-Ink mode intentionally forces a different high-contrast presentation, that
behavior SHALL be preserved and tested separately, and SHALL NOT be the
mechanism that fixes standard mobile theming.

#### Scenario: Standard mobile follows the app theme

- **WHEN** E-Ink mode is not active and the app theme is dark on mobile
- **THEN** the EPUB SHALL be rendered with the dark app theme

#### Scenario: Explicit E-Ink presentation is preserved

- **WHEN** explicit E-Ink mode is active
- **THEN** the reader SHALL keep its deliberate E-Ink presentation (for
  example high-contrast and paginated defaults)
- **AND** the standard-mode theming behavior SHALL remain unchanged

### Requirement: Theme application is bounded to lifecycle points

The viewer SHALL apply theming only at sensible lifecycle points: initial
content mount, new spine content mount, explicit reader setting/theme change,
and necessary rendition render events. It SHALL NOT recreate the epub.js Book
or Rendition on theme change, reload the EPUB, regenerate locations, walk
every DOM node during normal scrolling, re-style on every `relocated` event,
introduce a React render loop, or poll continuously.

#### Scenario: Scrolling does not re-style content

- **WHEN** the reader scrolls within or across sections
- **THEN** the override styling SHALL NOT be re-applied on every
  `relocated` event
- **AND** only newly mounted content documents receive styling

#### Scenario: Theme change is cheap

- **WHEN** the theme changes while an EPUB is open
- **THEN** the change SHALL update the rendition theme and the mounted content
  documents only
- **AND** the book instance, rendition instance, locations, and reading
  position SHALL be unchanged
