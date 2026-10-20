## Why

Settings search currently matches category translation keys, a small keyword list, and category descriptions, then opens a whole category. Users who remember a control's name or purpose can miss it entirely or still have to hunt through a long panel after searching; search should take them from familiar words to the relevant setting.

## What Changes

- Index individual settings and meaningful groups across every currently reachable Settings section, using their displayed labels, descriptions, category paths, and curated everyday aliases. Retain category results for broad searches.
- Match localized text, multiword queries, common abbreviations, and small spelling mistakes with predictable relevance ranking and no network dependency.
- Show specific result names and category/group breadcrumbs so users can distinguish similar settings, such as interface font size and EPUB font size.
- Open the correct section, reveal collapsed content when necessary, and scroll to and visibly identify the matched setting without changing its value or executing an action.
- Preserve the query, result position, and return focus when navigating from a result and back on compact layouts; provide accessible search, result counts, clear-search, and useful no-result recovery.
- Keep hidden or unsupported features out of actionable results, and link settings with recoverable prerequisites to their existing setup explanation.
- Add a maintained coverage inventory and acceptance cases so new or renamed settings do not silently become undiscoverable.

## Capabilities

### New Capabilities

- `settings-search`: Comprehensive local discovery of Settings controls and groups, tolerant matching, localized and accessible results, precise target revelation, and search navigation continuity.

### Modified Capabilities

None. Existing `settings-return-navigation`, `accountless-experience`, and `command-registry` requirements remain in force. Global Command Palette expansion is outside this change.

## Impact

- Settings shell and shared metadata: `src/components/settings/SettingsPage.tsx` and `src/components/settings/settingsSections.ts`.
- New lightweight Settings search catalog, matching helpers, and target-revelation contract, with target anchors added to reachable Settings panels and nested configuration surfaces.
- Existing local matching primitive in `src/utils/fuzzy.ts`, platform/product availability gates, and localization dictionaries in `src/lib/i18n/`.
- Focused catalog/matching/navigation tests, a deterministic search benchmark, and desktop/compact visual and accessibility verification during implementation.
- No backend, settings persistence migration, external search service, or new package dependency is expected. Section panels must remain lazy-loaded, and existing Command Palette section ids and navigation must remain compatible.
