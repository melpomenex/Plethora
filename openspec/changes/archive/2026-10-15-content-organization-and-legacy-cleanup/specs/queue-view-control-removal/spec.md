## REMOVED Requirements

### Requirement: "High Retention" and "New Material Exploration" Queue View controls
The Queue View SHALL no longer show the "High-Retention Maintenance" and "New Material Exploration" session-block cards (`src/components/review/ReviewQueueView.tsx:1439–1466`, titles from `src/utils/reviewUx.ts:331–354`) or their time-budget inputs in `SessionCustomizeModal.tsx:202–262` ("Maintenance Block (min)", "Exploration Block (min)"). They are unused local component state, not persisted settings.

#### Scenario: Blocks absent from Queue View
- **WHEN** the user opens Queue View
- **THEN** no "High-Retention Maintenance" or "New Material Exploration" block cards SHALL be visible

#### Scenario: Budget inputs absent from session customization
- **WHEN** the user opens the session customization modal
- **THEN** the "Maintenance Block (min)" and "Exploration Block (min)" inputs SHALL be absent

### Requirement: Dead code for the removed blocks is removed
The now-dead implementation SHALL be removed: `buildSessionBlocks`, `SessionBlock`, `SessionBlockTimeBudgets`, `computeSafeStop` (`src/utils/reviewUx.ts:22–35,331–354,416–433`), the block-card JSX and its consumers in `ReviewQueueView.tsx`, the modal inputs, the `sessionCustomize.maintenanceBlock`/`explorationBlock`/`blockTimeBudgets` i18n keys where they become unused, and the corresponding tests.

#### Scenario: No dangling references
- **WHEN** the removal is complete
- **THEN** no remaining code SHALL reference the removed block builders/types/keys, and the build SHALL pass

## MODIFIED Requirements

### Requirement: Unrelated scheduling/retention functionality is preserved
Removing the two controls SHALL NOT remove or alter unrelated scheduling or retention functionality: queue strategy presets (including "Maximize Retention" / "Exploratory Learning" presets, which are distinct from the blocks), postpone (item/smart/all, `queueStore.ts`, `PostponeAllDialog`), workload/forecast (`get_due_workload_forecast`, `get_workload_data`), easy days, scroll-mode settings, and the review-session goal UI (`review.retentionMaintenance` label in `ReviewSession.tsx`).

#### Scenario: Presets and scheduling remain
- **WHEN** the user opens Queue View after the removal
- **THEN** the queue strategy preset selector, postpone, workload/forecast, and easy-days functionality SHALL remain fully functional and unchanged