## Purpose

Keep the user's existing global priority order compatible and make a priority commit equally reliable from keyboard, mouse, and touch.

## ADDED Requirements

### Requirement: Priority has one compatible direction and durable meaning
Higher manual priority SHALL mean greater importance; 0 SHALL request the bottom and 100 the top of the global order. Existing stored order keys SHALL retain their ordering. Current displayed importance and ranking P SHALL derive from the same collection snapshot, with P=b/(N-1) for N>1 and .5 for N<=1, where b counts strictly lower keys among presentable elements. A derived bucket or request snapshot SHALL NOT be another independent manual input. Position 1 SHALL denote the top.

#### Scenario: Existing priorities are preserved
- **WHEN** an existing collection upgrades and contains low, normal, and high priority rows
- **THEN** no stored order is inverted or renumbered and displayed importance follows that order

#### Scenario: Rank requests at boundaries
- **WHEN** the user commits requests 0, 25, 50, 75, and 100 to otherwise equivalent items
- **THEN** greater requests place them monotonically higher, explicit zero survives reopening/restart, and same-key ties resolve deterministically

#### Scenario: Population and missing priority
- **WHEN** session filters change, the collection has one item, or a legacy record lacks valid priority evidence
- **THEN** session filtering alone does not change the rank population and singleton/unavailable evidence uses neutral P=.5

### Requirement: All input methods share a complete commit lifecycle
Keyboard shortcuts, preset buttons, sliders, numeric inputs, and touch completion SHALL commit through the same validated operation for the intended entity. Escape SHALL cancel drafts without writes. Repeated completion events SHALL NOT submit the same intent twice. The committed value SHALL survive tab changes, reopening, and process restart, and queue ordering SHALL reflect it.

#### Scenario: Keyboard persistence through the backend
- **WHEN** the user invokes the configured priority command, edits its draft, and presses Enter
- **THEN** one backend operation stores the intended entity's value and a subsequent independent read after restart returns it

#### Scenario: Pointer and keyboard parity
- **WHEN** equivalent values are committed by pointer, keyboard, and touch
- **THEN** persistence, derived fields, ranking direction, and visible results agree

### Requirement: Pending and failed priority commits are observable
The interface SHALL bind a pending commit to its original entity, prevent duplicate activation, retain a failed draft for retry, and show a localized actionable error. Late completions SHALL NOT overwrite newer values or another item's control. Focus SHALL return to the invoking control and priority dialogs SHALL prevent background rating/navigation shortcuts.

#### Scenario: Failure and navigation race
- **WHEN** persistence fails or a user changes the viewed item while a save is pending
- **THEN** no success is claimed for an uncommitted value and no other entity is changed by the late result
