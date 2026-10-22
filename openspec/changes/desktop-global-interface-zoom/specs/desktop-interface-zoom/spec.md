## Purpose

Scale the entire native desktop application interface — navigation, toolbars, tabs, settings, dialogs, review surfaces, and first-party overlays — with a device-local preference and predictable shortcut ownership, without changing document-specific zoom or typography.

## ADDED Requirements

### Requirement: Interface zoom is a desktop-only application capability

Interface zoom SHALL be available only in the native desktop application on Linux, Windows, and macOS. It SHALL scale the first-party application UI in the `main` application webview. It MUST NOT be applied to browser/PWA sessions, native Android builds, native iOS builds, or auxiliary webviews whose content is not the main application shell (including the screenshot overlay, external media popouts, and hidden article-capture windows).

On browser/PWA and native mobile, the application SHALL NOT advertise enabled interface-zoom controls or executable interface-zoom commands, SHALL NOT intercept the platform's zoom shortcuts, and SHALL NOT apply a persisted desktop interface-zoom value. Any unsupported-feature explanation shown in Settings MUST be non-interactive. Standard browser zoom SHALL remain the browser/PWA behavior.

#### Scenario: Desktop application

- **WHEN** the user runs the native Linux, Windows, or macOS application
- **THEN** the interface-zoom Settings control, keyboard shortcuts, and Command Palette commands are available
- **AND** changing the value scales the main application interface

#### Scenario: Browser or PWA

- **WHEN** the user runs Plethora in a browser or installed PWA
- **THEN** no enabled interface-zoom control or executable Command Palette command is shown
- **AND** any explanation shown is non-interactive
- **AND** the application does not call `preventDefault()` for Ctrl/Cmd zoom chords
- **AND** the browser's own zoom behavior remains in control

#### Scenario: Native mobile

- **WHEN** the user runs the native Android or iOS application
- **THEN** no enabled interface-zoom control or executable command is shown
- **AND** a desktop interface-zoom preference is not applied to the mobile interface

#### Scenario: Auxiliary webview

- **WHEN** the screenshot overlay, a YouTube popout, or a hidden article-capture webview is open
- **THEN** that webview remains at its normal 100% scale
- **AND** only the main application webview is zoomed

#### Scenario: Unsupported desktop platform version

- **WHEN** the desktop runtime cannot support native page zoom (for example macOS older than 11)
- **THEN** the application does not call the native zoom API
- **AND** does not present an enabled interface-zoom control or executable command
- **AND** explains that the feature requires a supported desktop runtime

### Requirement: Zoom range, steps, and reset are deterministic

The interface zoom preference SHALL default to exactly 100%. The supported user-selectable range SHALL be 70% through 150% inclusive. Every user zoom-in action SHALL increase the preference by exactly 10 percentage points and every zoom-out action SHALL decrease it by exactly 10 percentage points, subject to the range bounds. Reset SHALL set the preference to exactly 100%.

The application SHALL NOT automatically choose a zoom value from detected screen size, device class, window size, or display resolution. A persisted value outside the supported range or not aligned to the 10-point step SHALL be normalized into the supported range and step without discarding the rest of the settings.

#### Scenario: First run

- **WHEN** no interface-zoom preference has ever been stored
- **THEN** the active interface zoom is exactly 100%

#### Scenario: Increase and decrease

- **WHEN** the current zoom is 100% and the user invokes Zoom In
- **THEN** the zoom becomes exactly 110%
- **WHEN** the current zoom is 110% and the user invokes Zoom Out
- **THEN** the zoom becomes exactly 100%

#### Scenario: Upper bound

- **WHEN** the current zoom is 150% and the user invokes Zoom In again
- **THEN** the zoom remains exactly 150%
- **AND** no out-of-range native zoom request is made

#### Scenario: Lower bound

- **WHEN** the current zoom is 70% and the user invokes Zoom Out again
- **THEN** the zoom remains exactly 70%
- **AND** no out-of-range native zoom request is made

#### Scenario: Reset from a non-default value

- **WHEN** the current zoom is 130% and the user invokes Reset Zoom
- **THEN** the zoom becomes exactly 100%

#### Scenario: Invalid persisted value

- **WHEN** a persisted zoom value is missing, non-numeric, below 70, above 150, or not a 10-point step
- **THEN** the application normalizes it to a supported step within 70–150
- **AND** all other persisted Settings values remain unchanged

#### Scenario: Smaller laptop display

- **WHEN** the application detects a 13-inch or 14-inch display, a small window, or a high-DPI panel
- **THEN** it does not change the zoom preference solely because of that detection

### Requirement: The preference is device-local and survives restarts

The application SHALL store interface zoom as one integer-percentage preference inside the existing local Settings store. The preference SHALL be local to the device and MUST NOT be added to cross-device settings synchronization. It SHALL survive a full application restart, a normal application update, a WebView reload, and opening or closing tabs. It SHALL NOT reset when navigating between views.

Existing user preferences SHALL be preserved when the new field is introduced; an older persisted Settings object without the field SHALL receive the 100% default while every other preference keeps its stored value.

#### Scenario: Restart restores the value

- **WHEN** the user sets interface zoom to 130% and fully quits and relaunches the application
- **THEN** the application restores 130% after startup

#### Scenario: Application update

- **WHEN** the user installs a newer Plethora build over an existing installation
- **THEN** the previously selected interface zoom remains selected

#### Scenario: Navigation and tab changes

- **WHEN** the user switches views, opens or closes tabs, or reads a document after changing zoom
- **THEN** the interface zoom remains at the selected value
- **AND** no route change or tab mount resets it to 100%

#### Scenario: Existing settings are preserved

- **WHEN** an existing installation's persisted Settings object has no interface-zoom field
- **THEN** interface zoom becomes 100%
- **AND** the user's theme, font, reading, learning, and other preferences remain unchanged

#### Scenario: Device-local boundary

- **WHEN** the same account is used on another device
- **THEN** the interface-zoom preference is not transferred by settings synchronization

### Requirement: Startup restores zoom before the application shell renders

The application SHALL read the persisted interface-zoom preference and apply it to the main WebView before the main React application shell is imported for first display. The first rendered application frame SHALL use the persisted value rather than 100% followed by a later correction. The branded static boot frame MAY remain at the platform's native scale because native page zoom cannot be applied before JavaScript executes, but the interactive application shell MUST NOT first appear at the wrong scale.

If startup application fails, the application SHALL record the failure, fall back to a consistent 100% state, and expose a non-blocking recovery notice rather than leaving the UI readout and native scale different.

#### Scenario: Persisted non-default value

- **WHEN** the application starts with 130% persisted
- **THEN** the first interactive application frame is rendered at 130%
- **AND** the Settings readout reports 130%

#### Scenario: Default value

- **WHEN** the application starts with 100% persisted
- **THEN** the application shell renders at 100%
- **AND** no unnecessary persistent preference rewrite occurs

#### Scenario: Startup native failure

- **WHEN** the native zoom API rejects during startup
- **THEN** the application continues to start at 100%
- **AND** the persisted preference and the displayed percentage are reconciled to the same 100% state
- **AND** a non-blocking error notice explains that interface zoom could not be applied

### Requirement: Changes apply immediately without disruptive transitions

A zoom change SHALL apply to the running application without a restart, full-page reload, route remount, or loss of open tabs and in-progress work. The implementation MUST use native WebView page zoom rather than a CSS `transform: scale()` or CSS `zoom` wrapper around the application root. It SHALL NOT add a scaling animation or a layout-shifting transition.

All first-party interface surfaces SHALL scale together, including the navigation rail, top toolbar, tab strip, library and RSS views, Settings, Assistant, flashcard/review surfaces, buttons, text, icons, menus, tooltips, popovers, and dialogs.

#### Scenario: Settings change

- **WHEN** the user changes the value in Settings
- **THEN** the interface scale changes immediately
- **AND** the application does not reload or lose the active tab

#### Scenario: Shortcut change

- **WHEN** the user presses a zoom shortcut while reading or browsing
- **THEN** the whole application shell changes scale immediately
- **AND** the document's own zoom or typography value does not change

#### Scenario: Whole-interface coverage

- **WHEN** interface zoom changes
- **THEN** navigation, toolbars, tabs, Settings, Assistant, review/flashcard surfaces, dialogs, menus, tooltips, and first-party overlays all reflect the same scale
- **AND** no first-party surface remains at the old scale

### Requirement: Keyboard shortcuts are platform-correct and single-handled

On Linux and Windows, Ctrl SHALL be the primary zoom modifier. On macOS, Cmd SHALL be the primary zoom modifier. The application SHALL support primary + `+`, primary + `=` (including Shift + `=`), primary + `-`, primary + `0`, and the practical numeric-keypad equivalents for add, subtract, and zero.

Each matching keydown SHALL produce exactly one zoom command and exactly one step. The matching handler MUST call `preventDefault()` and MUST prevent any other application or document handler from processing the same event. The shortcuts SHALL remain customizable through the existing shortcut store; an unmodified installation SHALL use the required defaults, and a customized binding SHALL be honored without the old default also firing.

The default primary-modifier chords SHALL work while focus is in a text input, textarea, content-editable field, or the Command Palette input. Custom bindings that do not use a primary modifier SHALL NOT fire in editable fields or while the Command Palette is open. Auto-repeat from holding a key SHALL be clamped by the range bounds.

#### Scenario: Standard plus on a US layout

- **WHEN** the user presses Ctrl+Shift+= on Linux/Windows or Cmd+Shift+= on macOS
- **THEN** the interface zoom increases by exactly one 10-point step

#### Scenario: Equal-key variant

- **WHEN** the user presses Ctrl+= on Linux/Windows or Cmd+= on macOS
- **THEN** the interface zoom increases by exactly one 10-point step

#### Scenario: Minus and zero

- **WHEN** the user presses primary + `-`
- **THEN** the interface zoom decreases by exactly one step
- **WHEN** the user presses primary + `0`
- **THEN** the interface zoom resets to exactly 100%

#### Scenario: Numeric keypad

- **WHEN** the user presses primary + Numpad Add, Numpad Subtract, or Numpad 0
- **THEN** the corresponding zoom-in, zoom-out, or reset action occurs exactly once

#### Scenario: Focus in a text field

- **WHEN** focus is inside a text input and the user presses a default primary-modifier zoom chord
- **THEN** the interface zooms once
- **AND** no text is inserted or modified

#### Scenario: Custom binding

- **WHEN** the user rebinds Zoom In in Settings → Shortcuts
- **THEN** the new binding invokes interface zoom
- **AND** the previous default binding does not also invoke it

#### Scenario: Command Palette open

- **WHEN** the Command Palette is open and the user presses a default primary-modifier zoom chord
- **THEN** the interface zooms once
- **AND** the palette query is not modified

#### Scenario: Auto-repeat at a boundary

- **WHEN** the user holds Zoom In at 150% or Zoom Out at 70%
- **THEN** the value remains at the boundary
- **AND** no further native zoom requests are issued

### Requirement: Interface zoom owns Ctrl/Cmd zoom chords; document zoom stays separate

On desktop, Ctrl/Cmd + `+`, `-`, and `0` SHALL have one application-wide meaning: interface zoom. While the main application window is focused, document viewers and readers MUST NOT also change their own zoom, scale, font size, or typography in response to those chords. A single key press MUST NOT change both layers.

Document-specific zoom and typography SHALL remain available through their existing visible controls, their existing reader-scoped Ctrl/Cmd + wheel gestures, and their existing Command Palette actions. Those document actions SHALL be named so they are distinguishable from application zoom. Modal-local unmodified `+`, `-`, and `0` shortcuts (for example, an image/asset zoom modal) MAY remain because they do not use the reserved primary-modifier chords.

#### Scenario: PDF viewer

- **WHEN** a PDF is open and the user presses primary + `+`
- **THEN** only the application interface zoom increases
- **AND** the PDF page scale does not change
- **AND** the PDF toolbar zoom controls still change the document scale when clicked

#### Scenario: EPUB reader

- **WHEN** an EPUB is open and the user presses primary + `+`
- **THEN** only the application interface zoom increases
- **AND** the EPUB font size does not change
- **AND** the visible A+/A− controls still change the EPUB font size

#### Scenario: HTML reader

- **WHEN** an HTML document is open and the user presses primary + `+`
- **THEN** only the application interface zoom increases
- **AND** the HTML font size does not change
- **AND** the visible font-size controls still change the HTML font size

#### Scenario: Reader-scoped wheel gesture

- **WHEN** the pointer is over a PDF, EPUB, or HTML reader and the user performs the existing Ctrl/Cmd + wheel gesture
- **THEN** the existing document-specific zoom or typography behavior remains available
- **AND** the application interface zoom does not change

#### Scenario: Document Command Palette action

- **WHEN** a document viewer is active and the user chooses the document zoom action from the Command Palette
- **THEN** the document zoom changes
- **AND** the application interface zoom does not change

#### Scenario: Image or asset modal

- **WHEN** an image/asset modal that uses unmodified `+`, `-`, and `0` is open
- **THEN** those unmodified keys continue to operate the modal
- **AND** primary-modifier chords still operate application interface zoom

### Requirement: Appearance Settings exposes an accessible interface-zoom control

Settings → Appearance SHALL contain a clearly labeled **Interface Zoom** control in the existing Display section. It SHALL show the current percentage and provide decrease, increase, slider, and reset-to-100% controls. It SHALL include brief helper copy stating that the setting scales the application interface and is separate from document zoom or reader font size.

The control SHALL reuse the existing Settings section/row primitives and theme tokens. It SHALL remain synchronized with changes made by shortcuts or the Command Palette, disable decrease/increase at the bounds, disable reset at 100%, and show a stable error state after a failed native application. On unsupported platforms the control SHALL be hidden or replaced with a non-interactive explanation rather than presenting a control that cannot work. On desktop, Settings search SHALL return the Interface Zoom destination for queries such as `interface zoom`, `ui zoom`, and `larger interface`, and activating that result SHALL reveal the existing control without changing its value.

#### Scenario: Change from Settings

- **WHEN** the user moves the slider to 120% or presses the plus/minus buttons
- **THEN** the percentage readout and the native interface scale update immediately
- **AND** the preference is persisted

#### Scenario: Reset from Settings

- **WHEN** the user presses Reset to 100%
- **THEN** the native scale and readout both become 100%
- **AND** the reset control becomes disabled

#### Scenario: Shortcut synchronization

- **WHEN** the user changes zoom with a shortcut while Settings is open
- **THEN** the Settings percentage and control states update to the new value

#### Scenario: Boundary controls

- **WHEN** the value is 70%
- **THEN** the decrease control is disabled
- **WHEN** the value is 150%
- **THEN** the increase control is disabled

#### Scenario: Unsupported platform

- **WHEN** interface zoom is not supported by the current runtime
- **THEN** the Settings surface does not present an enabled zoom control
- **AND** it explains that the feature is available in the desktop application

#### Scenario: Failed change

- **WHEN** a native zoom application fails
- **THEN** the control returns to the last successfully applied percentage
- **AND** shows a recoverable error rather than claiming the new value is active

#### Scenario: Settings search discovery

- **WHEN** a desktop user searches Settings for `interface zoom`, `ui zoom`, or `larger interface`
- **THEN** the Interface Zoom setting appears in the results with its Appearance/Display context
- **AND** activating the result reveals the existing control without changing the current zoom value

### Requirement: Command Palette exposes application zoom commands

The Command Palette SHALL expose **Zoom In**, **Zoom Out**, and **Reset Zoom** commands on supported desktop runtimes. Each command SHALL invoke the same centralized zoom action as Settings and the keyboard shortcuts. The commands SHALL be searchable by interface/UI/app zoom terms and SHALL be absent on browser/PWA and native mobile.

Document-viewer contextual actions SHALL remain available but SHALL be renamed to distinguish document zoom from application zoom (for example, “Zoom Document In”, “Zoom Document Out”, and “Reset Document Zoom”). Their old Ctrl/Cmd shortcut hints SHALL be removed or replaced with a truthful document-scoped description.

#### Scenario: Query for zoom

- **WHEN** the user opens the Command Palette and types `zoom`
- **THEN** application Zoom In, Zoom Out, and Reset Zoom commands are returned on desktop
- **AND** any active document-viewer zoom actions are visibly named as document zoom

#### Scenario: Execute from palette

- **WHEN** the user activates Zoom In from the Command Palette
- **THEN** the interface zoom increases by exactly one step
- **AND** the palette closes through its existing execution path

#### Scenario: Viewer active

- **WHEN** a document viewer is the active tab and the user searches `zoom`
- **THEN** application zoom commands and document zoom actions are distinguishable by name
- **AND** selecting either affects only its own layer

#### Scenario: Unsupported runtime

- **WHEN** the runtime is browser/PWA or native mobile
- **THEN** application zoom commands are not advertised

### Requirement: Native failures preserve a consistent user-visible state

If the native zoom request rejects, the application SHALL NOT leave the persisted preference, Settings readout, and actual native scale disagreeing. It SHALL restore the last successfully applied percentage in both the preference and the UI, log the failure for diagnostics, and show one non-blocking error notice. The user SHALL be able to retry by invoking any zoom action again. Unsupported-platform detection SHALL NOT produce an error notice.

#### Scenario: Native rejection after an interactive change

- **WHEN** the user changes from 100% to 110% and the native call rejects
- **THEN** the preference and readout return to 100%
- **AND** exactly one error notice is shown
- **AND** a later successful Zoom In can still reach 110%

#### Scenario: Rapid changes with one failure

- **WHEN** several zoom changes are queued and only the latest native request fails
- **THEN** the final preference and native scale are the last successfully applied value
- **AND** no older request can later overwrite the rollback

#### Scenario: Unsupported platform

- **WHEN** the runtime is not a supported desktop Tauri webview
- **THEN** no error toast is shown merely because zoom is unavailable

### Requirement: Zoom requests are serialized, coalesced, and listener-unique

The application SHALL have exactly one interface-zoom shortcut dispatcher and one native-application queue. Concurrent or rapid requests SHALL be serialized so the final native scale equals the last requested preference. Older requests MUST NOT apply after newer ones, and a stale failure MUST NOT roll back a newer successful value. Installing, unmounting, and reinstalling the application shell SHALL NOT create duplicate zoom listeners or double increments.

#### Scenario: Rapid key presses

- **WHEN** the user presses Zoom In five times from 100% before the first native call settles
- **THEN** the final preference is 150%
- **AND** the final native scale is 1.5
- **AND** the user does not receive five separate error notices

#### Scenario: Slow native call followed by a newer request

- **WHEN** a slow request for 110% is in flight and the user requests 120%
- **THEN** the controller applies the newest value after the slow request settles
- **AND** the final displayed and native values are 120%

#### Scenario: Shell remount

- **WHEN** the application shell unmounts and remounts
- **THEN** exactly one zoom shortcut listener is active

### Requirement: Native page zoom preserves a usable responsive layout

Native interface zoom SHALL change the WebView's effective CSS viewport consistently with browser page zoom, so responsive breakpoints and compact layouts re-evaluate. After a successful zoom application, the application SHALL refresh JavaScript viewport consumers (for example, by dispatching a window resize notification) so shell decisions based on `window.innerWidth` stay consistent with CSS media queries.

At every supported zoom level, the application SHALL avoid page-level two-axis scrolling, clipped primary controls, unreachable dialogs, and overlays positioned outside the visible viewport. At the configured minimum window size and 150% zoom, secondary panes SHALL collapse, scroll, or move into an existing drawer/sequential presentation rather than compressing the primary content below usability. At 70%, the application SHALL use the additional workspace rather than rendering a fixed-width island with artificial empty margins.

#### Scenario: Minimum window at maximum zoom

- **WHEN** the main window is at its configured minimum size and interface zoom is 150%
- **THEN** navigation, search/Command Palette access, the active tab's primary content, and an overflow path for secondary actions remain reachable
- **AND** the page does not require horizontal and vertical page-level scrolling at the same time

#### Scenario: Standard laptop sizes

- **WHEN** interface zoom is changed through 70%, 80%, 90%, 100%, 110%, 120%, 130%, 140%, and 150% at 1280×800, 1366×768, 1440×900, and 1920×1080
- **THEN** the shell reflows at the normal CSS breakpoints
- **AND** dialogs, menus, tooltips, and the Command Palette remain fully visible and operable

#### Scenario: Split views

- **WHEN** a document reader or Assistant split view is open and zoom increases
- **THEN** secondary panes remain reachable through their existing collapse/drawer/sequential behavior
- **AND** the primary reading or review surface is not clipped

#### Scenario: Reduced workspace

- **WHEN** interface zoom is 70%
- **THEN** the application uses the larger effective CSS viewport
- **AND** does not introduce a fixed content island or artificial horizontal scrollbar

### Requirement: Zoom preserves accessibility, focus, and visual stability

The zoom control and all zoom actions SHALL be operable by keyboard alone. Controls SHALL have programmatic labels, visible focus indicators, and an accessible current-value announcement. The percentage readout SHALL be exposed as text, the slider SHALL expose its minimum, maximum, current value, and percentage value text, and controls SHALL meet the existing Settings touch-target conventions.

Interface zoom SHALL NOT introduce animations or transitions solely for scaling. Existing reduced-motion and E-Ink behavior SHALL remain in effect. The interface SHALL remain readable and operable in light, dark, high-contrast, and E-Ink themes, and on high-DPI displays. Dialogs and overlays SHALL remain within the viewport with correctly positioned tooltips and popovers. Scroll position SHALL be preserved where the platform's page zoom preserves it; a reader's logical position MUST NOT be discarded by a zoom change.

#### Scenario: Keyboard-only operation

- **WHEN** a keyboard-only user tabs to the Interface Zoom controls
- **THEN** the slider and buttons are reachable in a logical order with visible focus
- **AND** Enter/Space activates buttons and arrow keys adjust the slider

#### Scenario: Screen reader

- **WHEN** a screen reader focuses the zoom slider or readout
- **THEN** it announces the Interface Zoom label, the current percentage, and the 70–150% range

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion or E-Ink mode is active
- **THEN** changing zoom does not introduce a scaling animation
- **AND** the change is applied immediately

#### Scenario: Theme consistency

- **WHEN** the application is in light, dark, high-contrast, or E-Ink mode
- **THEN** the zoom controls use the active theme tokens and remain legible

#### Scenario: Dialog and tooltip reachability

- **WHEN** the interface is zoomed to 150% and a dialog, menu, tooltip, or popover opens near a viewport edge
- **THEN** it is repositioned or constrained within the visible viewport
- **AND** no action button is clipped or unreachable

#### Scenario: Reading position

- **WHEN** the user changes interface zoom while reading
- **THEN** the application does not intentionally reset the reader to the document start
- **AND** the existing reader position persistence remains authoritative
