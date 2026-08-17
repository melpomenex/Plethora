## ADDED Requirements

### Requirement: Production capabilities exclude dev-server origins
The production capability file SHALL NOT grant IPC access to remote URLs that no production component binds (the Vite dev-server origins). Development builds SHALL receive equivalent grants through a dev-only capability file that is excluded from release builds.

#### Scenario: Release capability has no dev origins
- **WHEN** the shipped capability file is inspected in a release build
- **THEN** the remote-URL list contains only origins the production app actually serves (e.g. the plugin-localhost frontend origin)

#### Scenario: tauri dev still works
- **WHEN** a developer runs the app in dev mode against the Vite dev server
- **THEN** the dev-only capability grants the dev origin and IPC functions normally

### Requirement: The production loopback origin is monitored for hijacking
Because the production frontend origin (plugin-localhost port) must remain in capabilities, the app SHALL detect at startup whether that port was already bound by another process and fail closed (refuse to navigate the main window to it, surface an error) rather than loading foreign content with full IPC grants.

#### Scenario: Port already taken by another process
- **WHEN** the app starts and the plugin-localhost port is occupied by a non-app process
- **THEN** the main window does not navigate to that origin and the user sees an explanatory error

#### Scenario: Normal startup unaffected
- **WHEN** the app starts and binds the port itself
- **THEN** startup proceeds exactly as before
