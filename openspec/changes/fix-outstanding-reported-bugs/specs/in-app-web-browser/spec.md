## ADDED Requirements

### Requirement: Pages render in the browser tab

Opening a URL in the in-app browser SHALL display the page, or SHALL display an explicit failure state naming the reason. It SHALL NOT leave a blank pane.

#### Scenario: Embeddable page under Tauri

- **WHEN** the user navigates to a URL in the browser tab in the desktop app
- **THEN** the page renders in the native webview
- **AND** the webview is positioned over the tab's content area and resizes with it

#### Scenario: Site refuses embedding

- **WHEN** a site cannot be embedded (for example `X-Frame-Options: DENY` or a frame-ancestors CSP on the web build)
- **THEN** the tab shows a blocked state naming the site and the reason
- **AND** offers to open the URL in the system browser

#### Scenario: Navigation fails

- **WHEN** navigation fails (bad host, no network, timeout)
- **THEN** the tab shows the error and a retry action
- **AND** the previous page is not left partially rendered

### Requirement: The webview tracks its container

Under Tauri the native webview SHALL stay aligned with the tab's content area across the events that move or hide it.

#### Scenario: Container geometry changes

- **WHEN** the window is resized, a split pane is resized, or the toolbar position changes
- **THEN** the webview's bounds follow the tab's content area

#### Scenario: Tab is switched away

- **WHEN** the browser tab is no longer the active tab
- **THEN** the native webview is hidden
- **AND** it is shown again, at the correct bounds, when the tab is reactivated

### Requirement: Extract creation from the page

The browser SHALL create an extract from text selected in the page.

#### Scenario: Selection captured

- **WHEN** the user selects text in the embedded page and creates an extract
- **THEN** an extract is created carrying the selected text, the page URL and the page title

#### Scenario: Selection cannot be read

- **WHEN** the selection cannot be read from the embedded page
- **THEN** the user is told extract creation is unavailable for this page
- **AND** no empty extract is created
