# Specification: Database & Settings Migration

## ADDED Requirements

### Requirement: Database startup migration updates legacy algorithm types
The SQLite migration runner SHALL execute migration `086_complete_plethora_identity_migration` on startup, updating all existing `learning_items.algorithm_type` column values from legacy identifiers (`"adaptive"`, `"precision"`, `"m1"`, `"m2"`, `"m3"`, `"m4"`) to canonical Plethora identifiers (`"adaptive"`, `"precision"`, `"classic"`, `"classic_5"`, `"classic_8"`, `"classic_15"`).

#### Scenario: Existing user cards are migrated to canonical algorithm types
- **GIVEN** a database with `learning_items` having `algorithm_type = 'adaptive'` and `algorithm_type = 'precision'`
- **WHEN** migration `086` executes
- **THEN** rows with `'adaptive'` are updated to `'adaptive'`, rows with `'precision'` are updated to `'precision'`, and card intervals, stabilities, and review counts are preserved without modification

### Requirement: Database startup migration renames ensemble and arena tables
The SQLite migration runner SHALL rename legacy Plethora Precision collection tables (`arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`) to their canonical names (`arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`) and remove unused diagnostic tables.

#### Scenario: Arena and optimizer state tables are preserved under canonical names
- **GIVEN** an existing database with populated `arena_state` and `arena_m3_matrices` tables
- **WHEN** migration `086` executes
- **THEN** all existing matrix and arena weight rows are accessible under `arena_state` and `arena_m3_matrices` with zero data loss

### Requirement: Frontend settings store migrates legacy algorithm selection
When the settings store hydrates persisted settings from `localStorage`, it SHALL convert legacy `algorithm` strings (`"adaptive"`, `"precision"`, `"m1"`) to their canonical values (`"adaptive"`, `"precision"`, `"classic"`) and migrate `precisionPureKernel` $\to$ `precisionPureKernel` and `arenaReviewMode` $\to$ `arenaReviewMode`.

#### Scenario: Existing user preference is migrated seamlessly
- **GIVEN** a user whose persisted `localStorage` settings contains `{"learning": {"algorithm": "adaptive", "arenaReviewMode": "choose"}}`
- **WHEN** the frontend application starts and hydrates the settings store
- **THEN** `settings.learning.algorithm` becomes `"adaptive"` and `settings.learning.arenaReviewMode` becomes `"choose"`
