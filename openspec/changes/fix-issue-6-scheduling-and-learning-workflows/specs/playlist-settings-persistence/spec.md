## Purpose

Allow ordinary editing and reliable persistence of playlist defaults and subscription settings with clear queue behavior and accessible feedback.

## ADDED Requirements

### Requirement: Playlist settings use editable drafts and explicit commits
Global and per-subscription settings SHALL allow blank/intermediate numeric drafts without backend writes. Save SHALL validate and commit the form once, show pending then saved/error state, and retain failed drafts for retry; Cancel SHALL restore committed values. Background refreshes SHALL NOT replace dirty drafts or steal focus. Persisted values SHALL survive reopening and restart.

#### Scenario: Enter a multi-digit interval
- **WHEN** the user clears 5, types 12, and saves
- **THEN** typing does not revert or persist intermediate values and the backend subsequently reads 12

#### Scenario: Failed or reordered save
- **WHEN** saving fails or an old request completes after a newer edit
- **THEN** the current draft is retained, the correct form receives feedback, and no stale response overwrites it

### Requirement: Numeric validation agrees at both boundaries
The interface and authoritative persistence boundary SHALL accept only integers in these ranges: queue interval 1–50, legacy playlist priority 1–10, maximum consecutive videos 1–5, refresh interval 1–168 hours. Blank, non-finite, fractional, and out-of-range submitted values SHALL fail visibly without replacing them via truthiness defaults. Invalid historical values SHALL be identified for correction rather than silently rewritten.

#### Scenario: Invalid value reaches the command directly
- **WHEN** a caller submits interval 0, priority 11, or a fractional refresh interval outside the validated contract
- **THEN** persistence rejects the update and prior settings remain unchanged

### Requirement: Defaults affect new subscriptions and overrides remain local
Saved global interval and priority defaults SHALL seed new subscriptions at creation time. Changing defaults SHALL NOT overwrite existing subscriptions, individually reprioritized documents, or review schedules. The interface SHALL label global defaults and per-playlist settings distinctly, and higher legacy priority SHALL mean greater importance.

#### Scenario: Create after changing defaults
- **WHEN** defaults are saved as interval 12 and priority 8, then a subscription is created
- **THEN** the new subscription stores 12 and 8 while existing subscriptions retain their saved settings

### Requirement: Saved interspersion settings govern the queue
An enabled subscription's saved interval N SHALL insert a playlist video after N non-playlist items, subject to the global consecutive-video limit and existing eligibility rules. Coincident slots SHALL resolve by subscription priority then stable subscription/video identity. New imports SHALL seed document rank once from subscription priority; subsequent manual document priority SHALL win.

#### Scenario: Interleaving after persistence
- **WHEN** a subscription saves N=3 and a deterministic pool contains enough eligible ordinary items/videos
- **THEN** queue output reflects that cadence without violating the consecutive limit, and a relaunch uses the same committed settings

### Requirement: Playlist controls remain discoverable and accessible
Meaningful setting groups and controls SHALL have stable Settings search targets and coverage entries with correct reveal behavior. Labels, errors, save states, keyboard operation, focus retention, touch access, and narrow viewport layout SHALL remain usable. Local settings changes SHALL NOT require online playlist retrieval.

#### Scenario: Search and edit offline
- **WHEN** the user searches for playlist default priority while offline
- **THEN** the settings search reveals the corresponding labeled control and its locally supported edit/save flow remains available
