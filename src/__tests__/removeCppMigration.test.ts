/**
 * C++ migration removal (#8).
 *
 * The "Migrate from C++ Version" section, its stub handler, the dead
 * `api/migration.ts` client and unrouted migration components must be gone,
 * while the generic import/export surface (collection archives, app-state
 * backup/restore, `.db` restore, `.apkg`, legacy-archive import) must remain.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

describe("C++ migration removal (#8)", () => {
  it("ImportExportSettings no longer exposes the C++ migration section or stub handler", () => {
    const source = read("src/components/settings/ImportExportSettings.tsx");
    expect(source).not.toMatch(/migrateFromCpp|handleExportFromCPlusPlus|C\+\+ database migration/i);
    expect(source).not.toMatch(/Migrate from C\+\+ Version/);
  });

  it("the dead C++ migration API and components are deleted", () => {
    for (const rel of [
      "src/api/migration.ts",
      "src/components/migration/DataMigrationUI.tsx",
      "src/components/migration/MigrationReport.tsx",
    ]) {
      expect(existsSync(join(root, rel)), `${rel} should have been deleted`).toBe(false);
    }
  });

  it("no code references the removed C++ migration symbols", () => {
    const out = execSync(
      "grep -rn --include='*.ts' --include='*.tsx' -E 'migrate_cpp|read_cpp_database|DataMigrationUI|migrateFromCpp|api/migration' src/ | grep -v 'src/__tests__/removeCppMigration.test.ts' || true",
      { cwd: root, encoding: "utf8" }
    );
    expect(out.trim()).toBe("");
  });

  it("no locale still carries the migration.* or C++ importExport keys", () => {
    for (const loc of ["en", "de", "es", "fr", "ja", "zh"]) {
      const source = read(`src/lib/i18n/locales/${loc}.ts`);
      expect(source, `${loc} still has migration.* keys`).not.toMatch(/"migration\.[a-zA-Z]/);
      expect(source, `${loc} still has C++ import keys`).not.toMatch(/"importExport\.(migrateFromCpp|migrateDesc|whatWillBeImported|allDocumentsMetadata|flashcardsScheduling|categoriesTags|reviewHistory|appSettings|startMigration)"/);
    }
  });

  it("noNativeDialogs pending list no longer references the migration component", () => {
    const source = read("src/__tests__/noNativeDialogs.test.ts");
    expect(source).not.toContain("DataMigrationUI");
  });
});

describe("generic import/export preserved (#8)", () => {
  it("ImportExportSettings still wires the live backup/archive/legacy-import surface", () => {
    const source = read("src/components/settings/ImportExportSettings.tsx");
    // App-state backup/restore dialog
    expect(source).toContain("AppStateBackupDialog");
    expect(source).toContain("importExport.openBackupRestore");
    // Collection archives (export + import)
    expect(source).toContain("buildCollectionArchive");
    expect(source).toContain("parseCollectionArchive");
    expect(source).toContain("import_collection_archive");
    expect(source).toContain("restoreBrowserArchive");
    // .db restore
    expect(source).toContain("restore_local_db_backup");
    // .apkg import
    expect(source).toContain("import_anki_package_to_learning_items");
    // The live legacy-archive import path (NOT the C++ migration)
    expect(source).toContain("import_legacy_archive");
  });

  it("the Rust legacy-archive import command is still present", () => {
    const source = read("src-tauri/src/commands/legacy_import.rs");
    expect(source).toMatch(/import_legacy_archive/);
  });

  it("the live legacy app-data migration (MigrationReport in legacy_data.rs) is untouched", () => {
    const source = read("src-tauri/src/legacy_data.rs");
    expect(source).toMatch(/pub fn perform_migration/);
  });
});
