## ADDED Requirements

### Requirement: Tray/menu-bar/status-area icon appears while running
The system SHALL expose a recognizable Plethora tray/status/menu-bar icon while the application is running on supported platforms: Ubuntu and Linux desktops with an appropriate tray/status-notifier protocol, macOS menu bar, and Windows system tray where the shared implementation is sensible. The implementation SHALL use the platform/runtime's supported native abstraction (Tauri `TrayIconBuilder` + `tray-icon`/`libappindicator`), not a custom fake top bar.

#### Scenario: Icon visible on supported platforms
- **WHEN** Plethora is running on a supported desktop (Linux with a status-notifier-capable environment, macOS, Windows)
- **THEN** a recognizable Plethora tray/status/menu-bar icon SHALL be visible with the proper Plethora icon asset

#### Scenario: No icon on unsupported targets
- **WHEN** the app runs on a target without tray support (e.g. mobile)
- **THEN** tray code SHALL NOT compile or run (platform cfg-gated) and no broken tray artifacts SHALL appear

### Requirement: Minimal, sensible tray menu
The tray icon SHALL expose a minimal menu with existing relevant actions: Show/Open Plethora (show + focus the main window), Hide/Show window where supported, and Quit. Quitting through the tray SHALL actually terminate the application according to the existing application lifecycle.

#### Scenario: Tray menu actions
- **WHEN** the user opens the tray menu
- **THEN** the menu SHALL contain Show/Open, Hide/Show (where supported), and Quit; choosing Quit SHALL terminate the application

#### Scenario: Show/Open focuses the window
- **WHEN** the user selects Show/Open from the tray (with the main window hidden or unfocused)
- **THEN** the main window SHALL be shown, focused, and brought to the front

### Requirement: Close-to-quit behavior is preserved
Closing the main window SHALL continue to quit Plethora as it does today (no silent conversion to "minimize to tray forever"). If hiding-to-tray on close is ever added, it SHALL be a separate, explicitly specified and justified lifecycle change.

#### Scenario: Window close still quits
- **WHEN** the user closes the main window
- **THEN** Plethora SHALL quit, exactly as before this change

### Requirement: Platform icon rendering conventions
The tray icon SHALL render correctly per platform: proper HiDPI handling and no blurry scaling (reuse the existing `@2x` conventions / vector source where applicable); macOS SHALL use a menu-bar-appropriate icon including template/monochrome handling so it adapts to the menu bar appearance; Linux/Windows SHALL use an appropriately sized icon (e.g. 32×32).

#### Scenario: HiDPI rendering
- **WHEN** Plethora runs on a HiDPI display
- **THEN** the tray/status icon SHALL render crisply (not blurry) using the appropriate resolution/vector asset

#### Scenario: macOS menu-bar appearance
- **WHEN** Plethora runs on macOS and the menu bar appearance changes
- **THEN** the menu-bar icon SHALL render correctly (template/monochrome handling) and SHALL not appear as a large/full-color dock-style image in the menu bar

### Requirement: Linux/Ubuntu uses standard status-notifier protocol
The Linux implementation SHALL use the standard status-notifier/appindicator mechanism available through the framework (the `tray-icon` libappindicator backend already present), and SHALL work under the Ubuntu desktop configurations Plethora supports when tray/status icons are available. The implementation SHALL be realistic about desktop fragmentation (GNOME may require an extension; KDE Plasma/COSMIC typically support SNI) and SHALL NOT use desktop-specific hacks.

#### Scenario: Ubuntu with tray support
- **WHEN** Plethora runs on Ubuntu with a desktop environment exposing the status notifier
- **THEN** the tray icon SHALL appear and function via the standard protocol

### Requirement: Click behavior follows platform convention
Primary-click and right-click behavior SHALL follow platform convention (e.g. left-click shows/focuses the window; right-click opens the menu on Windows/Linux; macOS follows menu-bar conventions).

#### Scenario: Conventional clicks
- **WHEN** the user clicks the tray icon
- **THEN** the behavior SHALL match the platform convention (show/focus on primary click where conventional; menu on secondary click where conventional)

### Requirement: Reopening an already-running instance behaves sensibly
Where feasible, launching Plethora while an instance is already running SHALL focus the existing window rather than spawning a duplicate (e.g. via `tauri-plugin-single-instance` or platform handling). If not feasible without a new dependency, the behavior SHALL be documented as a known limitation.

#### Scenario: Reopen focuses existing instance
- **WHEN** the user launches Plethora while an instance is already running
- **THEN** the existing window SHALL be shown/focused and no second window SHALL be created (where single-instance is implemented); otherwise the multi-instance behavior SHALL be documented