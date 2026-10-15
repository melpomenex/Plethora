## ADDED Requirements

### Requirement: URL navigation via Tauri native fetch
The in-app web browser tab SHALL handle URL navigation by fetching page content via Tauri's Rust HTTP client (server-side fetch) to bypass webview CORS/CSP restrictions.

#### Scenario: Loading a standard web page
- **WHEN** the user enters a URL in the in-app browser
- **THEN** the system SHALL fetch the page content via the Rust backend and render the sanitized HTML in the webview

#### Scenario: URL with redirects
- **WHEN** the target URL returns HTTP redirects
- **THEN** the Rust HTTP client SHALL follow redirects and render the final page content

### Requirement: CSP/X-Frame-Options fallback
When a page's CSP or X-Frame-Options headers prevent direct rendering, the system SHALL fall back to a readable text extraction mode that displays the page's main content as formatted text.

#### Scenario: Page blocks iframe rendering
- **WHEN** a fetched page has `X-Frame-Options: DENY` or restrictive CSP headers
- **THEN** the system SHALL extract the main article/body text and display it in a reader-friendly format

#### Scenario: Page renders normally
- **WHEN** a fetched page has no restrictive headers
- **THEN** the system SHALL render the full HTML content in the webview
