## ADDED Requirements

### Requirement: User-visible product identity is Plethora
All user-facing surfaces SHALL present the product as **Plethora** with tagline "Read anything. Learn everything.": desktop bundle metadata (`productName`, publisher, copyright, descriptions in `tauri.conf.json`), window titles, `index.html` title/meta, PWA `public/manifest.json` (name/short_name), service-worker strings, Android `app_name`/launcher strings, browser-extension display name, README/docs front matter, CI workflow display names and artifact names, and all six i18n locales (`en`, `zh`, `es`, `de`, `fr`, `ja`). Historical CHANGELOG entries, git tags, and archived releases SHALL NOT be rewritten.

#### Scenario: Fresh install shows only Plethora branding
- **WHEN** the app is installed and opened on desktop, Android, or web/PWA
- **THEN** no user-visible string, installer screen, store-listing field, or OS-level app label contains "Incrementum"

#### Scenario: i18n keys are renamed without orphaned translations
- **WHEN** the seven legacy keys embedding the old name (e.g. `settings.aboutIncrementum`, `importExport.incrementumPackage`) are renamed
- **THEN** every `t()` call site uses the new keys and all six locale files carry the new keys with translated values

### Requirement: Plethora icon set is generated from the provided masters
The repository's Plethora icon masters (`plethora-icon-master.svg`, `plethora-icon-foreground.svg`) SHALL be committed to a tracked brand-assets location (`assets/brand/`, alongside the provided 1024/512 reference PNGs and the design-reference image; the root-level `plethora-icon-*` loose files SHALL be removed after relocation) and wired into the existing icon pipeline (`scripts/generate-icons.mjs`, `scripts/icon-map.json`) to produce every required target: Tauri desktop icons (icns/ico/png/store logos), Android mipmap sets incl. foreground, iOS AppIcon set (`src-tauri/icons/ios/`), PWA icons incl. maskable variants (`public/icons/`), extension icons, and favicon. Generated 1024/512 outputs SHALL visually match the provided reference PNGs; the reference image SHALL NOT be used as a pipeline input.

#### Scenario: Icon regeneration covers all targets
- **WHEN** the icon pipeline runs against the Plethora masters
- **THEN** every icon path referenced by `tauri.conf.json`, `public/manifest.json`, the Android `res/mipmap-*` tree, and `browser_extension/manifest.json` is regenerated with the Plethora mark

#### Scenario: Source assets are tracked and the root is clean
- **WHEN** the change lands
- **THEN** `assets/brand/` contains the masters, reference PNGs, and archive in git, and no untracked `plethora-icon-*` files remain in the repository root

### Requirement: Network-facing identifiers use Plethora
Outbound HTTP user agents and attribution headers SHALL use Plethora branding (e.g. `Plethora/<version>`, OpenRouter `X-Title: Plethora`) in both the Rust backend and the browser-mode mirror (`src/lib/browser-backend.ts`).

#### Scenario: OpenRouter attribution updated
- **WHEN** any component sends a request to OpenRouter
- **THEN** the `HTTP-Referer`/`X-Title` headers reference Plethora in Tauri and web modes

### Requirement: Internal identifiers are renamed mechanically
The Rust error enum `IncrementumError` SHALL be renamed (e.g. `PlethoraError`) across all ~1,092 sites; crate and package names SHALL become `plethora-tauri`/`plethora_tauri_lib` (Rust) and `plethora-tauri` (npm name); environment variables SHALL use the `PLETHORA_` prefix with CI/scripts updated in the same change; `scripts/release.cjs` version-bump regex SHALL be re-anchored to the new Cargo package name so release bumping cannot silently fail.

#### Scenario: Release script bumps the renamed crate
- **WHEN** `node scripts/release.cjs <version>` runs after the crate rename
- **THEN** `src-tauri/Cargo.toml` version is bumped (regex matches the new name) and CI version-consistency checks pass across package.json, tauri.conf.json, Cargo.toml

#### Scenario: Old env names tolerated where cheap
- **WHEN** a desktop environment still exports `INCREMENTUM_USE_KEYCHAIN`
- **THEN** the app honors it as an alias for the new `PLETHORA_USE_KEYCHAIN` variable during the transition
