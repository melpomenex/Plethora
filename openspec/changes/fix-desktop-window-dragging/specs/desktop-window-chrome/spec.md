## Purpose

Defines how Plethora's custom desktop window chrome behaves as a movable window surface wherever the app replaces native window decorations with its own chrome, while keeping every interactive control inside that chrome fully functional and preserving the intended borderless visual design.

## ADDED Requirements

### Requirement: Empty top chrome is a draggable window surface
Wherever Plethora renders its own window chrome without native decorations, empty and non-interactive areas of the topmost chrome SHALL move the window when the user presses the primary pointer button and drags, without requiring any keyboard modifier such as Meta or Alt.

#### Scenario: User drags from empty tab-strip space
- **WHEN** the user presses and drags an empty portion of the tab strip on Linux with custom decorations
- **THEN** the window follows the pointer and stays at the new position on release

#### Scenario: User drags from empty toolbar-row space
- **WHEN** the toolbar is positioned at the top of the desktop shell and the user presses and drags non-interactive space in that row on Linux
- **THEN** the window follows the pointer

#### Scenario: Dragging works without overflow-free space in the tab strip
- **WHEN** open tabs fill or nearly fill the strip so the trailing empty area is minimal
- **THEN** at least one reliable empty draggable area remains available in the topmost chrome

### Requirement: Interactive chrome elements never trigger window dragging
Interactive elements rendered inside the top chrome — including tabs, buttons, inputs, menus, links, and window controls — SHALL receive pointer interactions normally, and interacting with them MUST NOT move the window.

#### Scenario: Clicking a control inside the chrome
- **WHEN** the user clicks any interactive element inside the top chrome
- **THEN** the element receives the interaction and the window does not begin moving

#### Scenario: Dragging inside an interactive element
- **WHEN** the user starts a pointer drag on an interactive element such as a tab or input
- **THEN** the element's own drag or selection behavior proceeds and the window does not move

### Requirement: Window controls remain functional
The minimize, maximize/restore, and close controls SHALL continue to perform their existing functions and MUST NOT be treated as draggable background space.

#### Scenario: Operating window controls
- **WHEN** the user clicks minimize, maximize/restore, or close in the custom chrome
- **THEN** the corresponding window action occurs and no window movement is initiated

### Requirement: Double-click on empty chrome toggles maximize
Double-clicking an empty draggable area of the top chrome SHALL toggle maximize/restore, matching conventional title-bar behavior.

#### Scenario: Double-click empty chrome area
- **WHEN** the user double-clicks an empty draggable region of the top chrome while the window is restored
- **THEN** the window maximizes; repeating the action restores it

### Requirement: Maximized windows follow platform restore-and-drag semantics
Dragging from an empty chrome area of a maximized window SHALL use the platform-supported restore-and-drag behavior where the operating system provides it, and MUST NOT leave the window in a broken or stuck state.

#### Scenario: Drag begins on a maximized window
- **WHEN** the user drags an empty chrome area while the window is maximized
- **THEN** the window un-maximizes under the pointer and continues moving smoothly, or remains maximized if the platform provides no restore-on-drag semantics, and the application remains responsive either way

### Requirement: Window movement is delegated to the operating system
Window movement SHALL be initiated through supported Tauri/windowing APIs that delegate positioning to the OS or window manager. Plethora MUST NOT compute window coordinates itself during a drag.

#### Scenario: Dragging across multiple monitors
- **WHEN** the user drags the window from one display to another, including displays with different resolutions or scale factors
- **THEN** the window tracks the pointer correctly without jumping, offset errors, or scaling artifacts introduced by the application

### Requirement: Platform scoping of custom chrome dragging
Custom-chrome drag regions SHALL apply only where Plethora actually suppresses native decorations. Platforms with native decorations MUST rely on their native title bars, and mobile builds MUST NOT acquire desktop window-drag behavior.

#### Scenario: Application runs on macOS or Windows
- **WHEN** the app runs with native decorations enabled
- **THEN** dragging uses the native title bar and no redundant custom drag surface alters existing behavior

#### Scenario: Application runs on Android or iOS
- **WHEN** the app runs on a native mobile build
- **THEN** no desktop drag-region logic is active and mobile layout and event handling are unchanged

### Requirement: Custom chrome appearance is preserved
Enabling window dragging SHALL NOT reintroduce native title bars, add a visible fake title bar, or change the existing theme integration, navigation design, window-control placement, or visual density of the custom chrome.

#### Scenario: Visual regression check after the change
- **WHEN** the desktop shell is rendered before and after the change with the same theme
- **THEN** the chrome's appearance is unchanged apart from pointer cursor affordances over draggable areas, if any

### Requirement: Failed drag initiation degrades silently
If initiating a window drag fails, the application SHALL remain stable: no crash, no broken UI state, and no disruptive error surfaced to the user.

#### Scenario: Drag API rejects
- **WHEN** the underlying drag request fails (for example, an unsupported window state)
- **THEN** the failure is logged per project conventions and the UI continues to operate normally

### Requirement: Desktop window drag regression coverage
Plethora SHALL maintain automated coverage for the drag-surface filtering logic (interactive versus empty targets, primary-button-only, double-click detection, platform gating) and a documented manual validation matrix for actual OS window movement across Linux (X11 and Wayland), Windows, and macOS where custom chrome applies.

#### Scenario: Automated component tests run
- **WHEN** the frontend test suite runs
- **THEN** it verifies which pointer events initiate dragging and which are left for interactive children, including the no-op cases outside Linux desktop Tauri

#### Scenario: Manual release matrix executes
- **WHEN** a release validation pass covers desktop window behavior
- **THEN** it includes dragging from empty chrome in normal and maximized states, double-click toggling, window-control operation, and multi-monitor/scaled-display checks where hardware is available
