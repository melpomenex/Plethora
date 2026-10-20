## Why

The RSS List pane places status indicators, a thumbnail, headline, metadata, and up to six actions beside one another inside a nominal 420px pane. This can reduce headlines to one or two words per line, making large feeds difficult to scan; hover-only toolbar visibility also makes actions harder to discover.

## What Changes

- Replace only List article rows with a responsive header and separate preview body. Below 720px of actual list width, the headline spans the header's first row and the complete action group occupies its second row. Thumbnails and status indicators cannot consume headline width.
- Show two headline lines, source identity, optional relative date, status indicators, and every eligible existing action by default. Reveal up to four headline lines, a preference-limited excerpt, and optional author metadata on deliberate hover, keyboard focus, or an explicit details toggle.
- Keep all six actions, their ordering, visibility conditions, tooltips, handlers, and propagation behavior. Tagging retains its intentional selection of the article to open the existing tag editor.
- Use card-local interaction state, immediate intrinsic height changes with explicit virtualizer measurement, and a token-driven 150ms content fade. Preserve scrolling with stable virtualizer item keys and one scroll-adjustment authority.
- Preserve density, thumbnail, excerpt, card-height, author, date, and feed-icon preferences. No new setting or runtime dependency.

### Scope and non-goals

This change implements reference concept 5 within Plethora's existing themes and typography, across All, Unread, Favorites, and individual feeds using List. It does not redesign Magazine, Grid, the sidebar, the reader, scroll mode, search results, training behavior, filtering, persistence, or backend code. This change currently contains planning artifacts only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `article-layouts`: Add requirements for readable List headers, progressive disclosure, complete inline actions, keyboard/touch access, preference compatibility, and measured virtualized row heights. Amend the existing thumbnail-position scenario to allow a List thumbnail beside the preview body underneath the header.

## Impact

- Production changes expected later: `src/components/media/RSSReader.tsx`, new `src/components/media/RSSListArticleCard.tsx`, `src/styles/reading.css`, a small native-key guard in `src/components/media/KeyboardShortcutProvider.tsx`, and additional English accessibility strings in `src/lib/i18n/locales/en.ts` (other locales use the existing English fallback).
- Reuse `resolveRssPreferences`, `generateArticleExcerpt`, `formatFeedDate`, `getFeedIcon`, `IntelligenceIndicator`, Phosphor icons, and Material icon-button styling. Preference types and the customization panel need no schema or UI changes.
- Add targeted Vitest/Testing Library coverage and Playwright coverage through the existing RSS customization harness. Keep existing Magazine/Grid tests and the repository performance/bundle gate.
- No Rust, API, database, lockfile, dependency, or budget changes are intended. Existing worktree changes, including reader text-selection fixes, must be preserved.
