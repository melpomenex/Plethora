## REMOVED Requirements

### Requirement: Postpone settings include auto-postpone toggle
**Reason**: The prompt-only behavior conflicts with the setting's automatic session-start meaning.
**Migration**: Preserve the existing `autoPostponeEnabled` boolean and interpret `true` as automatic processing at the next new application session.

## ADDED Requirements

### Requirement: Postpone settings control automatic session recovery
`PostponeSettings` SHALL include `autoPostponeEnabled` (boolean, default false). When enabled, the system SHALL automatically process eligible overdue items once at the beginning of each new application session after settings and the backend are ready. It SHALL not require confirmation. When disabled, automatic scheduling mutations SHALL not occur. Manual postpone controls SHALL remain available regardless of this setting.

#### Scenario: Auto-postpone executes at session start
- **WHEN** `autoPostponeEnabled` is true and the new application session has overdue eligible content
- **THEN** the system processes those items automatically and provides a nonblocking result summary

#### Scenario: Auto-postpone disabled
- **WHEN** `autoPostponeEnabled` is false at session start
- **THEN** no automatic scheduling mutation occurs and manual postpone remains usable

#### Scenario: Manual setting persists on reload
- **WHEN** a user explicitly enables or disables Auto-Postpone and restarts Plethora
- **THEN** the stored choice is restored before the session-start decision is made
