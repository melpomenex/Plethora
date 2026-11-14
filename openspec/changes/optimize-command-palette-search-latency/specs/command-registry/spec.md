## MODIFIED Requirements

### Requirement: Single authoritative command registry
The Command Palette SHALL resolve searchable navigation destinations and actions from one typed registry, memoized across search keystrokes and pre-indexed (`PreparedCommand` normalization cache) so `matchCommands` executes without per-keystroke array rebuilding or repetitive lowercase allocations while preserving exact, alias, prefix, keyword, fuzzy, and description ranking tiers and deterministic tie-breaking.

#### Scenario: Palette surfaces share one registry
- **WHEN** a destination or action is registered
- **THEN** it is searchable in typed search without any additional per-surface registration
- **AND** it appears in browse (View all) and scope listings from the same entry

#### Scenario: Registry ids are unique and stable
- **WHEN** the registry is built
- **THEN** every entry id is unique
- **AND** ids do not change when labels, descriptions, or aliases are edited

#### Scenario: One entry per destination and intent
- **WHEN** two candidate entries would navigate to the same destination for the same user intent
- **THEN** the registry exposes exactly one entry for that destination and intent

#### Scenario: Repeated searches reuse pre-normalized command descriptors
- **WHEN** a user types a multi-character query across multiple sequential keystrokes without changing settings or view context
- **THEN** `buildCommandRegistry` descriptors are reused and `matchCommands` resolves using cached lowercase label/alias/keyword/description structures with identical match ordering and reduced latency
