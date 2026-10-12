## Why

RSS Customization exposes settings that are ignored, inconsistent across views, or lost during saving; changing font size currently does not reliably affect article text. Its modal also renders beneath the mobile bottom toolbar, obstructing interaction.

## What Changes

- Make every customization control produce its advertised effect, with explicit applicability for list, magazine, grid, and reading views.
- Share reader typography, width, alignment, and theme across app-rendered RSS content, full-content, Story, and Scroll views.
- Load saved preferences into the modal, merge partial updates, support clearing filters, and preserve global defaults with feed overrides in native and HTTP storage.
- Separate card height and thumbnail size from excerpt length; distinguish Card and List presentation; correct sorting semantics and descriptions.
- Replace misleading Briefing/Deep Dive/Trending claims with accurately named presentation presets using supported settings.
- Make save feedback reflect the actual asynchronous result and make Reset restore all customization defaults, including filters.
- Render the customization dialog and its backdrop above the bottom toolbar using the app's dialog layer, with usable mobile sizing and safe-area handling.
- Add behavioral, persistence, and browser checks for the complete settings matrix.

## Capabilities

### New Capabilities

- `rss-customization`: Effective, persisted RSS customization across supported app views and a correctly layered settings dialog.

### Modified Capabilities

None. The current canonical specs do not contain an RSS customization capability. Existing in-flight RSS reading and layout changes provide context but are not canonical specs.

## Impact

- Frontend: `RSSCustomizationPanel`, `RSSReader`, `RSSFullContentView`, `RSSScrollMode`, `StoryView`, `ArticleLayouts`, RSS preference API/types, reading styles, and localized control text.
- Backend: RSS preference request/response models, repository updates and lookup scoping, SQLite migrations, and HTTP defaults/handlers.
- Compatibility: existing saved preferences retain their values; new layout fields receive defaults. Legacy full-content reader preferences require a defined migration into the shared preference source.
- Verification: focused component/API/repository tests, computed-style and mobile overlay checks, frontend build checks, and the local performance benchmark gate. No new runtime dependency is planned.
