## ADDED Requirements

### Requirement: Automated documentation schema validation
The project SHALL include automated validation tooling (`scripts/docs-validate.mjs`) that parses all files in `docs/product/` against the JSON/Zod metadata schema. The validator SHALL fail with a non-zero exit code if any required frontmatter field is missing, invalid, or malformed.

#### Scenario: Schema validation failure on invalid metadata
- **WHEN** a documentation file omits the `id` field or provides an invalid status string
- **THEN** `scripts/docs-validate.mjs` logs the exact file and schema error and exits with code 1.

### Requirement: Cross-reference integrity and duplicate ID detection
The validation tooling SHALL verify that every feature ID is unique across the entire corpus and that all cross-references listed in `related` fields or markdown links point to valid, existing feature documents.

#### Scenario: Broken cross-reference detection
- **WHEN** a feature document references a non-existent feature ID `queue.supermemo.deprecated_item`
- **THEN** the validation script identifies the broken reference and reports the source file and line.

#### Scenario: Duplicate feature ID prevention
- **WHEN** two documentation files declare the same `id: tts.auto_scroll`
- **THEN** the validator immediately fails, listing the colliding files.

### Requirement: Registered action validation against codebase
The validation tooling SHALL extract all action IDs declared in documentation frontmatter and verify that each ID exists in the application's TypeScript action registry (`src/commandPalette/contextualActions.ts` or `src/features/help/registeredHelpActions.ts`).

#### Scenario: Undeclared action detection
- **WHEN** a document declares an action ID `settings.appearance.invalid_tab` that has no registered handler
- **THEN** the validator flags the action as unregistered and fails the validation run.

### Requirement: Codebase feature coverage reporting
The project SHALL provide a coverage analysis tool (`scripts/docs-coverage.mjs`) that inventories user-facing Tauri commands (`src-tauri/src/commands/`), Zustand settings slices (`src/stores/settingsStore.ts`), navigation routes, and UI components, comparing them against the documented feature registry.

#### Scenario: Coverage metric calculation
- **WHEN** `npm run docs:coverage` is executed
- **THEN** it outputs a structured report detailing total active features, documented features, verified features, deprecated features, and any uncovered features.
