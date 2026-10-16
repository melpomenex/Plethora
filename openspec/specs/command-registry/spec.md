# command-registry Specification

## Purpose
One authoritative, typed registry of searchable Command Palette destinations and actions, with deterministic local matching, ranking, deduplication, and availability gating shared by every palette surface.

## Requirements

### Requirement: Single authoritative command registry

The Command Palette SHALL resolve searchable navigation destinations and actions from one typed registry. Each registry entry SHALL declare a stable id, a localized label, a description, an icon or icon reference, a category, aliases, keywords, availability requirements, and an executable action. Typed search, browse (View all), scope filters, and help-intent navigation SHALL all derive from this registry, and no palette surface SHALL maintain an independent copy of a destination or command.

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

### Requirement: Consistent matching semantics

Command matching SHALL be case-insensitive and SHALL behave identically regardless of the active view or scope. A query SHALL match on exact label, exact alias, label prefix, alias prefix, keyword, fuzzy similarity (typo tolerance), or description. Multiword queries SHALL match an entry only when every query token matches at least one field of that entry. Matching SHALL be pure and local, and SHALL NOT depend on document content providers.

#### Scenario: Case-insensitive matching

- **WHEN** the user types "RSS" or "rss"
- **THEN** the same matching entries are returned in the same order

#### Scenario: Alias matching

- **WHEN** the user types an alias such as "feeds" for RSS or "stats" for Analytics
- **THEN** the mapped destination matches

#### Scenario: Multiword query

- **WHEN** the user types "new flashcard"
- **THEN** entries matching only one of the two tokens are excluded
- **AND** the Create Flashcard action matches because every token matches within it

#### Scenario: Typo tolerance

- **WHEN** the user types a small misspelling such as "podcasst"
- **THEN** the Podcasts destination is still matched via fuzzy similarity

#### Scenario: View-independent behavior

- **WHEN** the same query is typed while a document viewer, RSS, or podcast view is active
- **THEN** the same matching entries and ranking are produced, independent of the active view

### Requirement: Deterministic relevance ranking

Command ranking SHALL follow this hierarchy, highest first: exact destination/action label, exact alias, prefix match, keyword match, fuzzy match, description match. A query that exactly matches a destination label or alias SHALL rank that destination above document content results, RSS articles, podcast episodes, help articles, and unrelated actions for the same query. Ties SHALL be broken deterministically. Context-sensitive actions of the active view SHALL retain priority over keyword, fuzzy, and description command matches, and SHALL be outranked by exact and alias destination matches. Explicitly requested help searches SHALL remain exempt from this hierarchy.

#### Scenario: Exact destination ranks first

- **WHEN** the user types "settings" or "analytics"
- **THEN** the matching destination is ranked as the first result, ahead of document content and help articles

#### Scenario: Exact alias ranks above weaker matches

- **WHEN** the user types "feeds"
- **THEN** the RSS destination is ranked ahead of entries that only contain "feeds" in keywords or descriptions

#### Scenario: Deterministic ties

- **WHEN** two entries match at the same rank tier
- **THEN** their relative order is stable across repeated searches

#### Scenario: Context-sensitive actions remain prioritized

- **WHEN** a view-specific action matches a query and no destination name or alias matches exactly
- **THEN** the context-sensitive action is ranked above keyword, fuzzy, and description command matches

#### Scenario: Help searches remain exempt

- **WHEN** the user explicitly requests help (for example, via a "?" or "help" prefix)
- **THEN** help results retain their dedicated presentation instead of being reordered behind navigation destinations

### Requirement: Equivalent commands are deduplicated

The Command Palette SHALL collapse equivalent commands, destination entries, and section results into one row per destination and scope. The palette SHALL NOT present two indistinguishable ways to open the same destination.

#### Scenario: Duplicate destination rows collapse

- **WHEN** a query matches a destination that is also represented by a narrower section entry
- **THEN** exactly one row for that destination is shown

#### Scenario: View all shows one entry per destination

- **WHEN** the user opens View all
- **THEN** each registered destination appears once, not once per palette surface

### Requirement: Availability requirements gate advertised commands

Registry entries SHALL declare platform capability gates and contextual preconditions. Entries whose capability is unavailable on the current platform, or whose precondition is not met, SHALL NOT be advertised as executable commands. A command that requires recoverable setup SHALL open the relevant setup or explain the requirement rather than silently doing nothing.

#### Scenario: Platform-unavailable destination

- **WHEN** a destination is unavailable on the current platform
- **THEN** its command is not advertised in the palette

#### Scenario: Precondition not met

- **WHEN** a command requires context that is not currently available (for example, a text selection)
- **THEN** the command is omitted from results instead of being shown disabled or as a no-op

#### Scenario: Recoverable setup

- **WHEN** an advertised command needs configuration before it can complete
- **THEN** the app opens the relevant setup or shows an actionable explanation
- **AND** does not silently close as though the operation succeeded

### Requirement: Command resolution is local, offline, and responsive

Command matching and ranking SHALL be pure local computation with no network dependency and no LLM call, and SHALL complete within the palette's interactive latency budget at registry scale. Document, extract, RSS, podcast, and help search providers SHALL continue to be reached only for content queries.

#### Scenario: Offline matching

- **WHEN** the device is offline
- **THEN** navigation and action commands still match and execute

#### Scenario: No LLM in command matching

- **WHEN** the user types a query
- **THEN** matching uses local string algorithms only
- **AND** no AI provider or network request is made for command matching

#### Scenario: Interactive latency

- **WHEN** a query is typed against the full registry
- **THEN** matching completes within the palette's debounce and latency budget without blocking content search
