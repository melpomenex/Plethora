# Specification: Database & Settings Migration

## ADDED Requirements

### Requirement: Database startup migration updates legacy algorithm types
The SQLite migration runner SHALL execute migration `086_complete_plethora_identity_migration` on startup, updating all existing `learning_items.algorithm_type` column values from legacy identifiers (`"sm18"`, `"sm20"`, `"sm2"`, `"sm5"`, `"sm8"`, `"sm15"`) to canonical Plethora identifiers (`"adaptive"`, `"precision"`, `"classic"`, `"classic_5"`, `"classic_8"`, `"classic_15"`).

#### Scenario: Existing user cards are migrated to canonical algorithm types
- **GIVEN** a database with `learning_items` having `algorithm_type = 'sm18'` and `algorithm_type = 'sm20'`
- **WHEN** migration `086` executes
- **THEN** rows with `'sm18'` are updated to `'adaptive'`, rows with `'sm20'` are updated to `'precision'`, and card intervals, stabilities, and review counts are preserved without modification

### Requirement: Database startup migration renames ensemble and arena tables
The SQLite migration runner SHALL rename legacy SM-20 collection tables (`sm20_arena`, `sm20_m2_optimizer`, `sm20_m3_matrices`, `sm20_model_params`) to their canonical names (`arena_state`, `arena_m2_optimizer`, `arena_m3_matrices`, `arena_model_params`) and remove unused diagnostic tables.

#### Scenario: Arena and optimizer state tables are preserved under canonical names
- **GIVEN** an existing database with populated `sm20_arena` and `sm20_m3_matrices` tables
- **WHEN** migration `086` executes
- **THEN** all existing matrix and arena weight rows are accessible under `arena_state` and `arena_m3_matrices` with zero data loss

### Requirement: Frontend settings store migrates legacy algorithm selection
When the settings store hydrates persisted settings from `localStorage`, it SHALL convert legacy `algorithm` strings (`"sm18"`, `"sm20"`, `"sm2"`) to their canonical values (`"adaptive"`, `"precision"`, `"classic"`) and migrate `sm20PureM4` $\to$ `precisionPureKernel` and `sm20ArenaReviewMode` $\to$ `arenaReviewMode`.

#### Scenario: Existing user preference is migrated seamlessly
- **GIVEN** a user whose persisted `localStorage` settings contains `{"learning": {"algorithm": "sm18", "sm20ArenaReviewMode": "choose"}}`
- **WHEN** the frontend application starts and hydrates the settings store
- **THEN** `settings.learning.algorithm` becomes `"adaptive"` and `settings.learning.arenaReviewMode` becomes `"choose"`
