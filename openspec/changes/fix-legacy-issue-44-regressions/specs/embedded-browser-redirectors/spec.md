## ADDED Requirements

### Requirement: Search-result redirector URLs are unwrapped before loading

When the embedded browser is asked to navigate to a known search-engine redirector URL — including `www.google.com/url?q=`, `www.google.com/imgres?imgurl=`, `duckduckgo.com/l/?uddg=`, and `bing.com/ck/a` — it SHALL extract the target URL and load the target instead of the redirector, so clicking an ordinary search result loads the result page rather than a redirect interstitial. Malformed or missing parameters SHALL fall back to loading the original URL. The unwrap list SHALL be data-driven and extensible.

#### Scenario: Google result click loads the target page

- **WHEN** the user clicks an ordinary Google result whose link is a `/url?q=<target>` redirector
- **THEN** the browser loads `<target>` through the validated proxy path
- **AND** the page content renders rather than a blank or "Redirect Notice" interstitial

#### Scenario: Malformed redirector falls back safely

- **WHEN** a redirector URL carries a missing or unparsable target parameter
- **THEN** the browser attempts the original URL rather than an empty navigation

### Requirement: Failed or escaped frame navigation is surfaced

On the Tauri path, when the embedded browser's frame navigates away from the proxy or fails to signal readiness within a bounded timeout after a navigation request, the browser view SHALL present its existing failure affordances (reader view / open in system browser) instead of a silent blank frame.

#### Scenario: Escaped navigation shows the fallback UI

- **WHEN** an in-page navigation escapes the proxy and the frame does not become ready within the timeout
- **THEN** the browser view shows the blocked/failure state with its recovery actions
- **AND** the blank frame is not the only visible outcome

### Requirement: Redirector unwrapping preserves security boundaries

Redirector unwrapping SHALL NOT weaken URL validation: the unwrapped target MUST pass the same http/https safety check applied to any navigation, and MUST be fetched through the loopback proxy with its existing per-hop SSRF validation. The iframe sandbox attributes and the application CSP frame-src allowlist SHALL remain unchanged.

#### Scenario: A private-network redirector target is rejected

- **WHEN** a redirector's target parameter resolves to a private, loopback, or non-http(s) address
- **THEN** the navigation is rejected by the existing validation rather than loaded

#### Scenario: Unwrap changes no security configuration

- **WHEN** the redirector unwrap is applied
- **THEN** the proxy's validation rules, the iframe sandbox attribute set, and the CSP frame-src allowlist are unmodified
