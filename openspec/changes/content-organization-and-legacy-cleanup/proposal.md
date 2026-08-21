# Change: Content Organization and Legacy Cleanup

Covers numbered requirements **#7 (Obsidian defaults rebrand), #8 (remove C++ migration), #10 (category management), #12 (remove unused Queue View controls)**.

## Why

1. **Obsidian defaults still say "Incrementum" (#7):** The Obsidian integration renders "Incrementum"/"Incrementum Assets" as hard-coded default folder names and placeholders — `src/pages/IntegrationsPage.tsx:51–52,74–75`, `src/components/settings/IntegrationSettings.tsx:262–263,591,605`. A dormant default note template in `src/config/defaultSettings.ts:167` also contains `tags: [incrementum]`. These are **defaults for new/unconfigured values only** — existing users' stored config (`localStorage["integration_settings"]`) is untouched by `brandMigration` (which only migrates `incrementum-*`-prefixed keys), so renaming defaults is safe and non-destructive. Nearby stale branding (Anki deck/model names, `defaultSettings.ts` header comment) is documented; the i18n vault-id migration copy intentionally mentions "Incrementum" for legacy data and must stay.
2. **C++ migration is a dead stub (#8):** `src/components/settings/ImportExportSettings.tsx:753–784` shows a "Migrate from C++ Version" section whose handler is `alert("C++ database migration will be implemented in Phase 4.6")` (lines 370–373). The supporting API (`src/api/migration.ts`) invokes Rust commands that **do not exist anywhere** in `src-tauri`. `src/components/migration/DataMigrationUI.tsx` is not routed; only referenced by a test. The generic import/export features (collection archives, app-state backup, `.db` restore, `.apkg`, legacy archive import) are independent and must be preserved. Note: the "Migrate from C++" section is distinct from the live `import_legacy_archive` path (`src-tauri/src/commands/legacy_import.rs`) — that legacy archive import must NOT be removed.
3. **No category management (#10):** A `categories` table exists (`src-tauri/migrations/001_initial.sql:31–42`) but is **orphaned**: categories are stored as free-form string names on documents/extracts (not FK IDs), `src-tauri/src/commands/category.rs` `get_categories`/`create_category` are stubs, and there is no create/rename/delete UI. Per-item editing exists via `src/components/common/ItemCategoryEditor.tsx`. The tag-management UX (RSS `TagManagementView.tsx` + `tagsStore.ts`; inline JSON-array item tags with `ItemTagEditor.tsx`) is the reference interaction. Collections are a separate data-partitioning layer and must not be conflated with categories.
4. **Queue View unused controls (#12):** "High Retention" and "New Material Exploration" are the block-card titles for the "High-Retention Maintenance" and "New Material Exploration" session blocks in `src/utils/reviewUx.ts:331–354` (`buildSessionBlocks`), rendered in `src/components/review/ReviewQueueView.tsx:1439–1466`, with budget inputs in `src/components/review/SessionCustomizeModal.tsx:202–262`. They are pure local component state (not persisted, not wired to scheduling). They must be removed without touching unrelated scheduling/retention functionality (queue strategy presets, postpone, workload/forecast, easy days, scroll-mode settings).

## What Changes

### 1. Obsidian defaults (see `specs/obsidian-defaults-rebrand`)
Change all **default/unconfigured** Obsidian values from Incrementum to Plethora (folder names, placeholders, dormant template). Do not rewrite stored user configuration. Document nearby stale branding (Anki defaults) and the intentional legacy copy (vault-id migration i18n).

### 2. Remove C++ migration (see `specs/remove-cpp-migration`)
Remove the "Migrate from C++ Version" section from Import/Export, its stub handler, and the dead supporting code (`api/migration.ts`, `components/migration/*`, the `importExport.migrateFromCpp*` + orphaned `migration.*` i18n keys) and related tests. Preserve all generic import/export functionality and the live legacy-archive import path.

### 3. Category management (see `specs/category-management`)
Add create/rename/delete category management consistent with tag-management UX, or expose/fix existing hidden functionality — without duplicating it. Define data-integrity semantics for rename/delete given that categories are currently name-identity strings on documents/extracts (no orphaned items, no accidental data loss).

### 4. Queue View controls (see `specs/queue-view-control-removal`)
Remove the "High-Retention Maintenance" and "New Material Exploration" block cards and their budget inputs, plus now-dead code (block builders/types/tests). Keep queue strategy presets, postpone, workload/forecast, easy days, and all other scheduling features.

## Impact

### Affected Specs
- `obsidian-defaults-rebrand` (new, #7)
- `remove-cpp-migration` (new, #8)
- `category-management` (new, #10)
- `queue-view-control-removal` (new, #12)

### Affected Code Areas
- `src/pages/IntegrationsPage.tsx`, `src/components/settings/IntegrationSettings.tsx`, `src/config/defaultSettings.ts` (#7)
- `src/components/settings/ImportExportSettings.tsx`, `src/api/migration.ts`, `src/components/migration/*`, `src/lib/i18n/locales/*` (keys `importExport.migrateFromCpp*`, `migration.*`), `src/__tests__/noNativeDialogs.test.ts` (#8)
- `src-tauri/src/commands/category.rs`, `src-tauri/src/models/category.rs`, `src/components/common/ItemCategoryEditor.tsx`, `src/components/common/ItemTagEditor.tsx` (reference), `src/components/media/TagManagementView.tsx` + `src/stores/tagsStore.ts` (reference), `DocumentsView.tsx` (#10)
- `src/utils/reviewUx.ts` (`buildSessionBlocks`), `src/components/review/ReviewQueueView.tsx`, `src/components/review/SessionCustomizeModal.tsx`, `src/lib/i18n/locales/*` (`sessionCustomize.*Block`), `src/utils/__tests__/reviewUx.test.ts` (#12)

### Non-goals
- No removal of generic import/export, collection archives, or app-state backup.
- No removal of the live legacy-archive import path (`import_legacy_archive`).
- No conflation of categories with collections.
- No removal of queue strategy presets, postpone, workload/forecast, or easy days.