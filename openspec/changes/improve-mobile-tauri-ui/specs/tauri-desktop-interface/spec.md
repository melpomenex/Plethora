## ADDED Requirements

### Requirement: Tauri desktop uses an adaptive desktop shell
The Tauri desktop application SHALL use the desktop workspace at standard window sizes and an intentional compact-desktop workspace when the content area is narrower. Being inside Tauri MUST NOT by itself select either the mobile phone shell or a fixed-width desktop arrangement.

#### Scenario: Desktop window is resized narrower
- **WHEN** a Tauri desktop window is resized from a standard width into the compact-desktop range
- **THEN** navigation and secondary panes collapse or reorganize while the active tab and task state remain intact

#### Scenario: Desktop window expands again
- **WHEN** a compact Tauri window returns to a standard desktop width
- **THEN** desktop navigation and secondary panes are restored without duplicating the active content or losing its state

### Requirement: Compact window remains usable
The main Tauri window SHALL enforce a tested minimum usable size no greater than 760 by 560 CSS pixels. At that size, the user MUST be able to navigate, access the command/search surface, interact with the active tab, and reach overflowed toolbar actions without page-level two-axis scrolling.

#### Scenario: Window reaches minimum size
- **WHEN** the user resizes the main window to the configured minimum dimensions
- **THEN** core navigation, the active content header, and an overflow path for non-primary actions remain visible and operable

#### Scenario: Active feature normally uses multiple panes
- **WHEN** a multi-pane feature is viewed in a compact desktop window
- **THEN** secondary panes collapse into a drawer, inspector, or sequential view rather than compressing the primary pane below its usable width

### Requirement: Native window chrome is interaction-safe
The Tauri desktop interface SHALL provide platform-appropriate title and window chrome behavior. Any custom draggable region MUST exclude buttons, inputs, links, tabs, menus, and other interactive elements, and native minimize, maximize, close, resize, and system-menu behavior MUST remain available on supported platforms.

#### Scenario: User drags the window from a custom header
- **WHEN** the user starts a pointer drag from an empty draggable header region
- **THEN** the native window moves without activating nearby application controls

#### Scenario: User interacts with a control inside the header
- **WHEN** the user clicks, focuses, or drags an interactive control within the visual title area
- **THEN** the control receives the interaction and the window does not begin dragging

#### Scenario: Platform uses native decorations
- **WHEN** the app runs with native window decorations enabled
- **THEN** the application content avoids redundant window controls and clears the platform title area correctly

### Requirement: Desktop controls use appropriate density and input affordances
The Tauri desktop presentation SHALL use pointer-appropriate information density while preserving readable text and accessible focus targets. Common actions SHALL expose keyboard access and pointer hover/focus feedback, and icon-only actions SHALL expose accessible labels and tooltips where their meaning is not obvious.

#### Scenario: User operates the app with keyboard and pointer
- **WHEN** the user switches tabs, opens search, manages documents, or invokes toolbar actions in the Tauri desktop app
- **THEN** the workflow is available by pointer and keyboard with visible hover and focus feedback

#### Scenario: Toolbar space becomes constrained
- **WHEN** the desktop toolbar cannot display every action without overlap
- **THEN** lower-priority actions move into an accessible overflow menu while primary and stateful actions remain visible

### Requirement: Native visual surface remains stable
The Tauri desktop window SHALL render an opaque or intentionally composed themed surface during startup, resize, maximize, fullscreen transitions, and theme changes. Transparent-window configuration MUST NOT reveal unintended desktop content, produce unreadable chrome, or cause a persistent flash behind the app surface.

#### Scenario: App starts in a saved dark theme
- **WHEN** the Tauri window first becomes visible with a dark theme selected
- **THEN** the initial window surface matches the selected color scheme closely enough to avoid a bright startup flash

#### Scenario: User resizes or maximizes the window
- **WHEN** the native window changes size or display state
- **THEN** the background, backdrop, toolbar, and active content repaint as one coherent surface without exposed transparent gaps

### Requirement: Window and workspace state survive presentation changes
Responsive desktop presentation changes SHALL preserve the user's open tabs, active tab, split-pane content, scroll position, and unsaved in-memory form state. Window geometry SHALL continue to use the app's existing state-recovery behavior.

#### Scenario: Compact mode collapses a split pane
- **WHEN** resizing causes a visible split pane to collapse into a sequential presentation
- **THEN** both pane contents remain in workspace state and reappear when space is available

#### Scenario: App relaunches after a normal close
- **WHEN** the user reopens the Tauri desktop app after window state was saved
- **THEN** valid geometry is restored within the visible display area and the responsive shell is derived from the restored content size

### Requirement: Desktop window regression coverage
The Tauri interface SHALL have automated or harness-driven coverage for compact and standard widths, toolbar overflow, draggable-region exclusions, theme startup surface, and workspace-state preservation across resize transitions.

#### Scenario: Desktop resize matrix runs
- **WHEN** desktop interface validation runs
- **THEN** it covers the configured minimum window, compact desktop, standard desktop, and maximized presentations without clipped essential controls

