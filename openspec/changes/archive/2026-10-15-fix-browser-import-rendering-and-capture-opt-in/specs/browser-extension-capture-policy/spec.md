## ADDED Requirements

### Requirement: Automatic capture SHALL be opt-in
The browser extension SHALL default navigation auto-save, history capture, and bookmark capture to disabled, and missing or invalid settings SHALL resolve to disabled.

#### Scenario: Fresh extension installation
- **WHEN** the extension has no saved capture settings
- **THEN** passive navigation, history, and bookmark capture are disabled
- **AND** browsing does not create documents in the library

#### Scenario: Existing settings omit a capture flag
- **WHEN** a stored settings object does not contain one of the passive-capture flags
- **THEN** the effective value for that flag is false
- **AND** the options page displays the control as disabled

### Requirement: Passive listeners SHALL fail closed during initialization
The extension SHALL NOT send passive capture requests until settings have finished loading successfully, and a settings-load failure SHALL leave all passive capture modes disabled.

#### Scenario: Browser event arrives before settings load
- **WHEN** `tabs.onUpdated`, `history.onVisited`, or `bookmarks.onCreated` fires before settings initialization completes
- **THEN** the listener ignores the event
- **AND** it does not queue or send a page save using temporary defaults

#### Scenario: Settings load fails
- **WHEN** the extension cannot read or parse persisted settings
- **THEN** all passive capture flags remain false
- **AND** the extension continues to expose explicit user-triggered save actions

### Requirement: Disabled passive capture SHALL not write documents
When a passive-capture mode is disabled, its corresponding browser event SHALL have no library side effect.

#### Scenario: Navigation auto-save is disabled
- **WHEN** a tab finishes loading while navigation auto-save is disabled
- **THEN** the extension does not send a page request

#### Scenario: History capture is disabled
- **WHEN** the browser reports a visited URL while history capture is disabled
- **THEN** the extension does not send a history-derived page request

#### Scenario: Bookmark capture is disabled
- **WHEN** a bookmark is created while bookmark capture is disabled
- **THEN** the extension does not send a bookmark-derived page request

### Requirement: Explicit save actions SHALL remain available
The extension SHALL allow explicit page, link, all-tabs, and selection actions independently of passive automatic-capture settings.

#### Scenario: Explicit current-tab save with automatic capture disabled
- **WHEN** the user invokes Save Current Tab while all passive capture modes are disabled
- **THEN** the extension sends one explicit page save
- **AND** the desktop app can persist it as a readable document

#### Scenario: Explicit all-tabs save
- **WHEN** the user invokes Save All Tabs while automatic capture is disabled
- **THEN** the extension saves the valid tabs selected by that command
- **AND** it does not enable passive capture for later navigation

### Requirement: Enabled passive capture SHALL be scoped to its own event
Enabling one automatic-capture setting SHALL affect only its corresponding event source and SHALL NOT implicitly enable the other capture modes.

#### Scenario: History capture is explicitly enabled
- **WHEN** the user enables history capture and leaves bookmark and navigation capture disabled
- **THEN** a qualifying history event may send one history-derived page request
- **AND** bookmark creation and tab completion do not send requests solely because history capture is enabled

#### Scenario: Settings are changed at runtime
- **WHEN** the user changes a passive-capture setting in the options page
- **THEN** the worker reloads the effective settings before handling subsequent passive events
- **AND** disabling the setting prevents subsequent requests without changing prior documents
