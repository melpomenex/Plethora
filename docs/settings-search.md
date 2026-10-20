# Settings search: contributor guide

Settings search is local, deterministic discovery over the Settings tree. It is
not a second Settings UI: a result is a pointer to an existing control, group,
or section, and activating it never changes a value or runs an action.

## Adding or renaming a Settings control

1. **Add a stable target id.** Wrap the destination with the shared primitive:

   - `SettingsRow … searchId="family.control"` for standard rows.
   - `SettingsSection … searchId="family.group"` for meaningful groups.
   - `<SettingsSearchTarget id="family.control" label="…">` for bespoke
     markup, or `useSettingsSearchTarget(id)` when a wrapper would disturb the
     layout.
   - For collapsed content (nested tab, dialog, expandable group), also add a
     search-only reveal target and reference it with `revealTargetId`. The
     reveal callback may open existing UI, but must not persist a setting,
     select a provider, submit a form, start a download, record audio, or run a
     destructive action.

2. **Register the destination** in
   `src/components/settings/search/settingsSearchCatalog.ts`:

   - use the destination's actual displayed translation key when it has one;
     use `lit(...)` only for copy the panel itself still hardcodes;
   - keep aliases short and purposeful (`bigger text`, `volume buttons`,
     `speech to text`, `tts`, `dark mode`);
   - add availability (`cloud`, `desktop`, `app-updater`, provider state…) when
     the control is conditional;
   - give the entry a unique `id` and `targetId`. Separate controls keep
     separate ids even when their names are similar.

3. **Update the coverage inventory**
   (`settingsSearchCoverage.ts`) when adding a new section or a new family of
   controls. If a rendered control is intentionally not indexed, record the
   reason in `exclusions` — do not simply omit it.

4. **Add acceptance evidence**:

   - matcher/ranking/availability → `__tests__/settingsSearch.test.ts`;
   - live target/reveal/navigation → `__tests__/SettingsPage.search.test.tsx`
     or `__tests__/SettingsSearchNavigation.test.tsx`;
   - static target/coverage enforcement → `__tests__/settingsSearchCoverage.test.ts`.

5. **Run the gates**:

   ```bash
   npx tsc --noEmit
   npx vitest run src/components/settings src/commandPalette
   npm run bench:check
   npm run check:bundle
   openspec validate improve-settings-search --strict
   ```

## Rules

- Never index private values: API keys, endpoints, cookies, vault paths, backup
  contents, memory text, user-created provider names, or document contents.
- Never advertise planned/inactive controls. Disabled placeholders are not
  destinations; an available control with a recoverable prerequisite points at
  its existing setup explanation.
- Search text must be localized and must never render a raw translation key.
  English fallback terms stay searchable in every locale.
- Keep the catalog component-free: no React, panel modules, stores with side
  effects, or command-palette actions. Section entries are derived from
  `settingsSections.ts`; never hand-maintain a second section list.
- Panel chunks stay lazy. Search may know what a panel contains, but it must not
  import the panel into the Settings shell.
