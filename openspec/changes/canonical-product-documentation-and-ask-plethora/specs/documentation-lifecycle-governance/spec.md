## ADDED Requirements

### Requirement: Documentation impact gate in development lifecycle
Future OpenSpec proposals and pull requests that add, modify, or deprecate user-visible features or settings SHALL include an explicit "Documentation Impact" section. Implementation tasks MUST update or create corresponding canonical feature documents in `docs/product/` before the change is considered complete.

#### Scenario: Documentation impact requirement
- **WHEN** an OpenSpec change introduces a new reader control or modifies an algorithm's default interval
- **THEN** the proposal's tasks include updating the relevant canonical documentation and passing `npm run docs:validate`.

#### Scenario: Explicit no-documentation-impact marking
- **WHEN** a change contains internal refactoring, test additions, or non-user-visible dependency updates
- **THEN** the developer marks "Documentation Impact: None (internal refactoring)" and automated checks skip requiring new feature entries.

### Requirement: Continuous integration validation gate
The CI pipeline (`.github/workflows/ci-regression.yml` or `build:check`) SHALL execute `npm run docs:validate` and `npm run docs:coverage:check` on every pull request and push to `main`.

#### Scenario: CI fails on invalid or drifting documentation
- **WHEN** a commit introduces a broken documentation reference or invalid frontmatter
- **THEN** the CI `check` job fails, preventing unverified documentation from entering the release stream.

### Requirement: Index invalidation and version synchronization
When documentation files are updated, the build system SHALL regenerate the static metadata index (`.help/index.json` or bundled SQLite FTS assets) and update the corpus content hash. The running application SHALL detect version mismatches and refresh the local help index on application update.

#### Scenario: Automatic index rebuild on release
- **WHEN** a new version of Plethora is built with updated feature documents
- **THEN** the bundled search index is rebuilt with the new application version and doc hash, ensuring in-app help matches the running binary.
