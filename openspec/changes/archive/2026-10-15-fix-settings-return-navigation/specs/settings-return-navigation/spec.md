## ADDED Requirements

### Requirement: Settings exposes an app return control on every view
The system SHALL display an accessible control throughout the Settings experience that returns the user to the most recent valid non-Settings app location.

#### Scenario: Return destination is available
- **WHEN** a user opens Settings from another app tab and views any Settings section
- **THEN** every Settings view displays a return control whose accessible name identifies the prior destination when its title is available
- **AND** activating the control restores that destination without closing or losing the Settings tab

#### Scenario: Prior destination is unavailable
- **WHEN** Settings has no valid prior tab in navigation history
- **THEN** the return control remains usable and takes the user to the app's safe default destination

#### Scenario: Return target has been closed
- **WHEN** the tab that preceded Settings is closed before the user activates the return control
- **THEN** the system skips the invalid target and returns to the next valid history entry or the safe default destination

### Requirement: Settings back navigation is hierarchical on compact layouts
The system SHALL distinguish navigation within Settings from navigation out of Settings on compact layouts.

#### Scenario: Back from a Settings section
- **WHEN** a compact-layout user is viewing a Settings section and invokes hierarchical back
- **THEN** the system shows the Settings section menu
- **AND** the user remains in Settings

#### Scenario: Back from the Settings menu
- **WHEN** a compact-layout user is viewing the Settings section menu and invokes hierarchical back
- **THEN** the system returns to the most recent valid non-Settings app location or the safe default destination

#### Scenario: Explicit app return from a Settings section
- **WHEN** a compact-layout user activates the persistent app return control while viewing a Settings section
- **THEN** the system returns directly to the prior app location without requiring an intermediate trip through the Settings menu

### Requirement: Gestural and system back match visible Settings navigation
The system SHALL make supported edge-swipe-back and native/system-back actions follow the same Settings hierarchy as the visible back controls.

#### Scenario: Edge swipe from a Settings section
- **WHEN** a touch begins within the configured left-edge region on a Settings section, travels primarily rightward beyond the back threshold, and does not begin on a gesture-owned control
- **THEN** the system navigates to the Settings section menu exactly once

#### Scenario: Edge swipe from the Settings menu
- **WHEN** a qualifying edge-swipe-back completes on the compact Settings menu
- **THEN** the system returns to the most recent valid non-Settings app location or the safe default destination exactly once

#### Scenario: Vertical or protected interaction
- **WHEN** a touch is primarily vertical or begins on a control or surface that owns the gesture
- **THEN** Settings back navigation is not triggered
- **AND** the original interaction remains available

#### Scenario: Native back follows hierarchy
- **WHEN** the host emits a native/system-back action while Settings is active and no higher-priority overlay consumes it
- **THEN** the system performs the same hierarchical action as the visible Settings back control

### Requirement: Unsaved changes are protected for every Settings back path
The system SHALL apply the existing unsaved-change confirmation before any Settings back action that would leave the current Settings section or Settings itself.

#### Scenario: User cancels back with unsaved changes
- **WHEN** a user with unsaved changes invokes a visible, gestural, or system back action and declines the confirmation
- **THEN** the current Settings section remains visible
- **AND** the pending changes and navigation history remain unchanged

#### Scenario: User confirms back with unsaved changes
- **WHEN** a user with unsaved changes invokes a visible, gestural, or system back action and accepts the confirmation
- **THEN** the requested hierarchical back action completes exactly once
- **AND** the Settings unsaved-change indicator is cleared according to the existing discard behavior

### Requirement: Settings return navigation is keyboard and assistive-technology accessible
The system SHALL expose visible Settings navigation controls as semantic buttons with localized accessible names, visible focus treatment, and keyboard activation.

#### Scenario: Keyboard activation
- **WHEN** a keyboard user focuses a Settings return or hierarchy control and activates it with a standard button key
- **THEN** the corresponding back action executes with the same history and unsaved-change behavior as pointer activation

#### Scenario: Destination label localization
- **WHEN** the interface language changes
- **THEN** Settings back and return labels use localized strings while preserving the destination title when available

