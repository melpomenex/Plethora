## MODIFIED Requirements

### Requirement: New/unconfigured Obsidian defaults use Plethora instead of Incrementum
Default folder names, placeholders, and other default values for the Obsidian integration that still brand the integration as "Incrementum" SHALL use "Plethora" for new/unconfigured values. Specifically: default notes folder SHALL be "Plethora" (instead of "Incrementum"), default attachments folder SHALL be "Plethora Assets" (instead of "Incrementum Assets"), and the corresponding input placeholders SHALL be updated.

#### Scenario: New user sees Plethora defaults
- **WHEN** a user who has never configured Obsidian opens the Obsidian integration settings
- **THEN** the notes-folder and attachments-folder fields SHALL show "Plethora" and "Plethora Assets" (as defaults/placeholders), not "Incrementum"/"Incrementum Assets"

#### Scenario: Unconfigured export uses Plethora folders
- **WHEN** a user exports to Obsidian without having overridden the folder names
- **THEN** the export SHALL use the Plethora default folder names

### Requirement: Existing configured values are preserved
The change SHALL NOT rewrite or lose values already configured by existing users. Renaming defaults SHALL affect only new/unconfigured values; stored configuration (`localStorage["integration_settings"]`) SHALL remain as the user set it.

#### Scenario: Existing user's Incrementum folder kept
- **WHEN** an existing user previously configured the Obsidian notes folder to "Incrementum" (or any custom value)
- **THEN** after the update the stored value SHALL remain unchanged and SHALL continue to be used

### Requirement: Dormant default template branding is updated
The dormant default note template in `src/config/defaultSettings.ts` that contains `tags: [incrementum]` SHALL be updated to Plethora branding (e.g. `tags: [plethora]`) since it is a default value with no migration impact.

#### Scenario: Template default uses Plethora tag
- **WHEN** the default Obsidian template is inspected
- **THEN** the default tag SHALL be `[plethora]` (or a Plethora-branded tag), not `[incrementum]`

### Requirement: Nearby stale branding is documented and updated where safe
Stale Incrementum branding adjacent to the Obsidian integration SHALL be documented in this change and updated where it is a default/new-user value and non-destructive: e.g. Anki default deck/model names ("Incrementum", "Incrementum Basic", "Incrementum Cloze" in `src/config/defaultSettings.ts`, `src/utils/ankiExport.ts`, `src-tauri/src/anki.rs`), the `defaultSettings.ts` header comment, and the `github.com/melpomenex/Incrementum` link in legacy SettingsPage. The intentional legacy copy (vault-id migration i18n that must say "Incrementum", one-time app-data migration, file-dialog legacy `.incrementum` filter for backward compatibility) SHALL NOT be changed.

#### Scenario: Anki defaults rebranded
- **WHEN** a new user creates an Anki deck
- **THEN** the default deck/model names SHALL be Plethora-branded rather than "Incrementum"

#### Scenario: Legacy-compat strings preserved
- **WHEN** the legacy vault-id migration or legacy archive import is invoked
- **THEN** the Incrementum-branded compatibility copy and the `.incrementum` file filter SHALL remain unchanged