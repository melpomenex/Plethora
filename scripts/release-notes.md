### Added

- **Settings return navigation** — Every Settings section now has a persistent, accessible return control that takes you back to the app location you came from, with a meaningful destination label (and a safe "Back to app" fallback). On mobile it follows a layered hierarchy: section → Settings menu → prior app location.
- **Mobile edge-swipe-back & native back** — Edge-swipe and system back now follow the same navigation hierarchy as the in-app return control, including the Settings flow, while preserving vertical scrolling and controls that own horizontal gestures. Unsaved-change protection is enforced across button, gesture, and system-back exits.
- **Backend-ready gate for mobile webviews** — Native mobile webviews that issue IPC during startup now block on a `wait_for_backend_ready` gate until database migrations and managed services are ready, preventing early-command failures on cold launch.

### Fixed & Improved

- **Document Q&A section context integrity** — Selecting a heading with `#` now resolves to the section's actual body text before the LLM request, reconciling PDF/EPUB outline nodes with extracted-text headings (including duplicate titles) and expanding parent sections to their full descendant range. Title-only, empty, stale, or mismatched references now recover from the current document text, or block the request with a clear context-unavailable message instead of silently sending just the heading label. Focused-section content is assembled once and delivered consistently to both the user prompt and the structured `chatWithContext` payload, with honest truncation reporting.
- **Readable reader highlights** — Replaced the saturated, opaque default yellow in the PDF and EPUB readers with a softer, translucent treatment that preserves text contrast across every supported extract color and in both light and dark reading contexts. Persisted extract color values and the default-color behavior are unchanged; only reader rendering is affected.
- **Localized navigation strings** — Added the new settings-navigation strings across all supported locales (de, en, es, fr, ja, zh).
