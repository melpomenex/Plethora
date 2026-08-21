# Implementation Tasks

## 1. Obsidian defaults rebrand (#7)
- [x] 1.1 Change default notes folder "Incrementum" → "Plethora" and attachments "Incrementum Assets" → "Plethora Assets" in `IntegrationsPage.tsx:51–52,74–75` and `IntegrationSettings.tsx:262–263,591,605`
- [x] 1.2 Update dormant default template `tags: [incrementum]` in `src/config/defaultSettings.ts:167`
- [x] 1.3 Update safe adjacent defaults: Anki deck/model names (`defaultSettings.ts:176`, `ankiExport.ts:134,240–241`, `anki.rs:1145,1172,1676,1689`), `defaultSettings.ts` header comment, stale `github.com/melpomenex/Incrementum` link
- [x] 1.4 Do NOT change: vault-id migration i18n (`integrations.migrateVaultIds*`), legacy app-data migration copy, `.incrementum` backup filter, legacy-import code
- [x] 1.5 Verify no user-visible `incrementum` regressions via `brandInventory.test.ts`

## 2. Remove C++ migration (#8)
- [x] 2.1 Remove the "Migrate from C++ Version" section + stub handler from `ImportExportSettings.tsx`
- [x] 2.2 Remove `src/api/migration.ts`, `src/components/migration/DataMigrationUI.tsx`, `MigrationReport.tsx`
- [x] 2.3 Remove `importExport.migrateFromCpp*` and orphaned `migration.*` i18n keys from all 6 locale files
- [x] 2.4 Update/remove references in `src/__tests__/noNativeDialogs.test.ts` and any other tests
- [x] 2.5 Verify generic import/export (collection archives, app-state backup, `.db`, `.apkg`, legacy-archive import) still works

## 3. Category management (#10)
- [x] 3.1 Decide + document the identity model (name-identity vs migrating to `categories` FK table) with data-integrity semantics for rename/delete
- [x] 3.2 Implement create/rename/delete category management UI consistent with tag management (reference `TagManagementView.tsx`, `tagsStore.ts`)
- [x] 3.3 Wire rename/delete propagation across documents/extracts (no orphaned items)
- [x] 3.4 Fix or replace the stub `src-tauri/src/commands/category.rs` commands as needed; keep `get_category_stats`/`get_categories_by_collection` compatible
- [x] 3.5 Ensure assignment via `ItemCategoryEditor.tsx` still works; keyboard/mobile/theme-consistent

## 4. Queue View control removal (#12)
- [x] 4.1 Remove block cards from `ReviewQueueView.tsx:1439–1466` and budget inputs from `SessionCustomizeModal.tsx:202–262`
- [x] 4.2 Remove dead block code in `reviewUx.ts` (`buildSessionBlocks`, `SessionBlock`, `SessionBlockTimeBudgets`, `computeSafeStop`) and update consumers
- [x] 4.3 Remove unused `sessionCustomize.*Block` i18n keys
- [x] 4.4 Update `reviewUx.test.ts`; verify presets/postpone/workload/easy-days unaffected

## 5. Tests
- [x] 5.1 Obsidian: new-user default = Plethora; old user custom config preserved; template tag updated
- [x] 5.2 Import/Export: C++ migration absent; normal backup/export/import works
- [x] 5.3 Categories: create, rename (propagates), delete (handled safely), assigned content preserved
- [x] 5.4 Queue: obsolete controls absent; presets/scheduling remain
- [x] 5.5 Run `npm run test:run` affected suites; `npm run lint` on changed files; `npm run test:scripts`

## 6. Spec
- [x] 6.1 Confirm spec files match implementation
