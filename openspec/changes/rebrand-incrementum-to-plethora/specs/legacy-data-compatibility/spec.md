## ADDED Requirements

### Requirement: Existing desktop installations migrate in place
When a Plethora build launches with the new identifier `com.plethora.app` and finds its app-data directory absent or empty while the legacy `com.incrementum.app` directory exists, the app SHALL offer a one-time migration that copies/moves `incrementum.db` (plus WAL/SHM siblings), settings, `ai_keys/`, `tokens/`, media/document directories, whisper models, and custom themes into the new data directory. The legacy directory SHALL remain intact until the user confirms successful migration (rollback path). Corruption-quarantine detection SHALL also recognize legacy `incrementum.db.corrupt.*` siblings.

#### Scenario: Library survives the upgrade
- **WHEN** an Incrementum 2.7.0 desktop user runs Plethora for the first time and accepts migration
- **THEN** documents, extracts, review history, queues, collections, themes, and stored provider API keys are present and queryable, and the legacy directory is preserved

#### Scenario: Declining migration starts clean
- **WHEN** the user declines migration
- **THEN** Plethora starts with an empty library and does not delete or modify the legacy directory

### Requirement: Database filename transition is fallback-safe
The backend SHALL open `plethora.db` when present; otherwise fall back to `incrementum.db` in the same directory (including its quarantine siblings) and, after a successful open and migration check, atomically rename the file set to the new name. The `_schema_migrations` ledger and schema SHALL be untouched by renaming.

#### Scenario: Old database adopted and renamed
- **WHEN** only `incrementum.db` exists
- **THEN** the app opens it, verifies migrations, renames it (with `-wal`/`-shm`) to `plethora.db`, and subsequent launches open the new name directly

### Requirement: Local persistence keys migrate with dual-read window
A one-shot boot migrator SHALL copy legacy `incrementum-*` localStorage keys (settings v6 store, tabs, themes, feedback, recall-dismissal, update-skip, browser-mode keys) to the new `plethora-*` names and keep dual-read compatibility for one release. The service worker SHALL adopt cache name `plethora-v1` and purge legacy `incrementum-*` caches and the `incrementum-sw` IndexedDB on activation.

#### Scenario: Settings survive key migration
- **WHEN** a web/PWA user with legacy `incrementum-settings` opens the rebranded app
- **THEN** theme, appearance, and learning settings are preserved under the new key and legacy keys are cleaned up after successful migration

### Requirement: User-authored file formats remain readable
Plethora SHALL import backups carrying the legacy `.incrementum` extension indefinitely (exports use `.plethora`). The Obsidian integration SHALL write `plethora-id` frontmatter but SHALL continue matching records on legacy `incrementum-id` values; no automatic rewrite of user vaults occurs (an explicit opt-in "migrate vault ids" settings action MAY be offered).

#### Scenario: Legacy backup imports
- **WHEN** a user imports a `foo.incrementum` app-state backup exported by Incrementum
- **THEN** the import succeeds with full fidelity

#### Scenario: Existing vault keeps syncing
- **WHEN** Obsidian export runs against a vault whose notes carry `incrementum-id`
- **THEN** existing notes are matched and updated rather than duplicated

### Requirement: Cross-boundary protocol strings change atomically with compat window
The app↔extension contract (postMessage sources, `data-*-app` attribute, `incrementum-highlight` CSS class and related DOM ids) SHALL move to `plethora-*` equivalents, with the app accepting both old and new tokens for one release; the paired extension release listens for both. Keychain access SHALL write new service names (`com.plethora.app`, `com.plethora.app.ai`) while reading through to legacy services and encrypted-file fallbacks, migrating credentials on first successful read.

#### Scenario: Paired release keeps extension working
- **WHEN** the rebranded app runs with the previous extension version during the compat window
- **THEN** page capture and extract sync continue to function via the legacy protocol tokens

#### Scenario: API keys migrate to new keychain service
- **WHEN** Plethora first reads provider keys stored under the legacy keychain service or `<app_data>/ai_keys/`
- **THEN** keys are readable, and re-saved under the new service name without prompting the user to re-enter them

### Requirement: Update channel transition does not strand users
The updater endpoint, update checker, and release tooling SHALL target the Plethora repository and artifact names (`Plethora_*`), signed with a new minisign key (old pubkey accepted for one transitional release). A final Incrementum-branded release from the legacy repo SHALL present an in-app notice directing users to the Plethora download, without silently switching the old updater.

#### Scenario: Updater verification passes for new artifacts
- **WHEN** `scripts/verify-update-artifact.mjs` and `verify-release-updates.mjs` run against a Plethora release
- **THEN** signatures and `latest.json` entries validate for all required platforms

### Requirement: Retained legacy identifiers are documented
A `BRANDING.md` file SHALL enumerate every intentionally retained legacy identifier (import extensions, vault keys, keychain read-through, legacy data-dir fallback, AMO gecko id if kept, historical tags/releases) so later proposals do not "clean them up" erroneously.

#### Scenario: Documentation exists and is discoverable
- **WHEN** a developer searches for remaining "incrementum" occurrences after this change
- **THEN** every hit is either historical (CHANGELOG/tags), a documented compat shim, or listed in `BRANDING.md`
