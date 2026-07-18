## ADDED Requirements

### Requirement: Expose Active Theme Configuration
The local server (BrowserSyncServer) SHALL expose the active visual theme and its associated colors via a JSON API endpoint.

#### Scenario: Retrieve Active Theme Successfully
- **WHEN** the browser extension sends a GET request to `/api/theme`
- **THEN** the server SHALL return a JSON object with `success: true` and a `colors` object mapping theme CSS variables (e.g. background, surface, primary, text, border) to their current hex codes

### Requirement: Apply Desktop Theme in Extension Popup
The browser extension popup SHALL query the local server on load to retrieve the active theme configuration and apply it dynamically.

#### Scenario: Apply Theme on Popup Load
- **WHEN** the extension popup loads and successfully fetches `/api/theme` from the local server
- **THEN** the popup SHALL inject the retrieved colors into its CSS variables (`--primary`, `--primary-dark`, `--success`, `--warning`, `--danger`, `--bg-dark`, `--bg-card`, `--text-primary`, `--text-secondary`, `--border`) and render a background gradient derived from the background color
