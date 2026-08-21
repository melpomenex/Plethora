## REMOVED Requirements

### Requirement: "Migrate from C++ Version" Import/Export section
The Import/Export interface SHALL no longer expose the "Migrate from C++ Version" section (`src/components/settings/ImportExportSettings.tsx:753–784`) or its stub handler (`handleExportFromCPlusPlus`, lines 370–373).

#### Scenario: Section absent from Import/Export
- **WHEN** the user opens Import/Export settings
- **THEN** no "Migrate from C++ Version" section/button SHALL be present

### Requirement: Dead C++ migration code paths
The dead supporting code for the C++ migration SHALL be removed: `src/api/migration.ts` (a client for Rust commands that do not exist), `src/components/migration/DataMigrationUI.tsx` and `MigrationReport.tsx` (unrouted), the `importExport.migrateFromCpp*` i18n keys and the orphaned `migration.*` i18n key family, and related tests/assets. Rust command invocations that do not exist SHALL NOT be left as dead API surface.

#### Scenario: Dead API and components removed
- **WHEN** the repository is searched for `migrate_cpp`, `read_cpp_database`, `DataMigrationUI`, `migrateFromCpp`
- **THEN** only intentional references remain (none should), and no unrouted C++ migration components persist

## MODIFIED Requirements

### Requirement: Generic import/export functionality is preserved
Removing the C++ migration SHALL NOT remove or break generic import/export: collection archives (`import_collection_archive`/`_merge`), app-state backup/restore (`AppStateBackupDialog`, `appStateImport`/`appStateExport`), `.db` restore, `.apkg` import, and the **live legacy-archive import** (`import_legacy_archive` in `src-tauri/src/commands/legacy_import.rs`, wired in `ImportExportSettings.tsx:326–350`). Current-format backup imports SHALL remain compatible.

#### Scenario: Backup/export/import still works
- **WHEN** a user exports a collection archive, a full app-state backup, or imports a valid backup/archive after the removal
- **THEN** those flows SHALL continue to work exactly as before

#### Scenario: Legacy archive import still works
- **WHEN** the user imports a legacy `.zip`/archive containing an Incrementum database via the generic import handler
- **THEN** the legacy archive import path SHALL still function (it is not the C++ migration)