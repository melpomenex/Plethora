## Purpose

Help users find an existing setting by its name or familiar purpose and reach the corresponding control directly, with consistent local search across languages and device layouts.

## ADDED Requirements

### Requirement: Search covers reachable settings rather than categories alone

Settings search SHALL discover every user-configurable preference and meaningful configuration group reachable through the current Settings UI, including controls inside nested tabs, expandable groups, and configuration dialogs. Search SHALL use displayed labels, descriptive copy, section/group context, and curated aliases. Category results SHALL remain available for broad queries. Inactive components, planned controls, and features with no Settings destination SHALL NOT be advertised as configurable settings.

#### Scenario: Search for an individual control
- **WHEN** a user searches for "font size"
- **THEN** results include the interface font size and EPUB font size settings when available
- **AND** each result identifies its own section and group rather than only offering Appearance or Documents

#### Scenario: Search before visiting a panel
- **WHEN** a user searches for an available setting in a Settings section they have not yet opened
- **THEN** the setting is discoverable without first visiting that section

#### Scenario: Search for a category
- **WHEN** a user searches for a displayed category name such as "Appearance"
- **THEN** a result opens that category
- **AND** specific matching settings remain distinguishable from the category result

#### Scenario: Newly added setting
- **WHEN** a configurable preference is added or renamed in a reachable Settings panel
- **THEN** its displayed name and destination are included in search coverage before the change is accepted

### Requirement: Familiar phrases and tolerant matching find the intended setting

Search SHALL ignore case, leading/trailing whitespace, repeated whitespace, and hyphen versus space differences. It SHALL match multiword queries across a single result's label, aliases, description, and category/group context regardless of word order, requiring every query token to match that result. Curated aliases SHALL cover common user language and abbreviations. Small spelling mistakes in words of at least four characters SHALL be tolerated without requiring fuzzy matching for shorter tokens.

#### Scenario: Multiword query across fields
- **WHEN** a user searches for "EPUB font size" or "size font EPUB"
- **THEN** the EPUB font size setting matches using its label and context
- **AND** unrelated entries matching only "EPUB" or only "font" are excluded

#### Scenario: Whitespace and punctuation normalization
- **WHEN** a user searches for "  FONT   SIZE  "
- **THEN** the same results appear in the same order as for "font size"

#### Scenario: Everyday aliases
- **WHEN** a user searches for "bigger text", "volume buttons", "speech to text", or "TTS"
- **THEN** results include the corresponding font size controls, Volume Rocker Scroll control, audio transcription configuration, or text-to-speech configuration respectively when available

#### Scenario: Small misspelling
- **WHEN** a user searches for "font siez"
- **THEN** the font size settings remain discoverable
- **AND** exact matches for a correctly spelled query rank ahead of typo-only matches

#### Scenario: Blank query
- **WHEN** a user clears the query or enters only whitespace
- **THEN** Settings displays its normal category navigation without a no-results message

### Requirement: Results use the current interface language

Search SHALL match the same localized labels, descriptions, and category/group names that users see, including contiguous label text in languages that do not separate words with spaces. Search-only aliases and UI copy SHALL be localizable. Existing English terminology and product/provider names SHALL remain searchable as fallback terms. Translation keys SHALL NOT appear as user-facing result labels or substitute for localized matching.

#### Scenario: Search for a translated label
- **WHEN** a user searches for a setting or category using its displayed label in the selected interface language
- **THEN** the corresponding result is returned with its localized name and path

#### Scenario: Runtime language change
- **WHEN** the interface language changes while Settings remains open
- **THEN** result text and searchable localized fields update when the language becomes available
- **AND** users do not need to close Settings to search the new displayed labels

#### Scenario: English fallback terminology
- **WHEN** a user with a non-English interface searches for "font size" or a supported provider's product name
- **THEN** the corresponding available setting remains discoverable

### Requirement: Ranking and result identity are predictable

Search SHALL rank exact setting/category labels above exact aliases, prefixes, ordinary token matches, typo-only matches, and description-only matches, in that order. Within the same relevance tier, direct label matches SHALL take precedence over matches that rely only on broader section context. Ties SHALL be deterministic. Each destination SHALL appear once, while controls with similar names in different locations SHALL remain separate and show enough path context to distinguish them.

#### Scenario: Precise name beats broad context
- **WHEN** a query exactly matches an available setting's label
- **THEN** that setting ranks above results matching only an alias, a parent category, a description, or a typo

#### Scenario: Similar settings in different panels
- **WHEN** multiple font size controls match a query
- **THEN** each result shows its own category/group breadcrumb
- **AND** repeated searches return those results in a stable order

#### Scenario: Several fields match one destination
- **WHEN** one setting matches through both its name and several aliases
- **THEN** search displays a single result for that destination

### Requirement: Selecting a result reveals the corresponding setting

Activating a result SHALL open the appropriate Settings section and reveal the matched control or meaningful configuration group, including existing nested tabs, expandable content, or configuration dialogs when needed. The target SHALL be scrolled into the visible content area and visibly identified. Keyboard and assistive-technology users SHALL receive focus at an appropriately named target container. Navigation SHALL NOT change a preference, select a provider, download a model, execute a destructive action, or submit a form.

#### Scenario: Result in a long or unopened section
- **WHEN** a user activates an individual setting result in a long section that is still loading
- **THEN** Settings waits for the target to become available and reveals it after loading
- **AND** the user does not have to scroll through the section to find it

#### Scenario: Result inside nested configuration
- **WHEN** a user activates a setting inside an inactive subtab or collapsed group
- **THEN** the correct subtab or group is opened before the target is identified
- **AND** existing setting values remain unchanged

#### Scenario: Keyboard arrival
- **WHEN** a keyboard user activates a result
- **THEN** focus moves to the named setting or group after it is ready
- **AND** the user can continue to its control with normal keyboard navigation

#### Scenario: Target cannot be revealed
- **WHEN** the setting becomes unavailable or its destination cannot finish loading
- **THEN** Settings provides a localized explanation with retry or return-to-results recovery as appropriate
- **AND** does not silently show an unrelated setting as a successful match

#### Scenario: A newer navigation supersedes a pending target
- **WHEN** a user changes destination before an earlier result finishes loading
- **THEN** completion of the earlier request does not change the current section, scroll position, or focus

### Requirement: Search respects availability and setup requirements

Search SHALL use the same product and platform availability rules as the destination Settings UI. Hidden or unsupported controls SHALL be omitted. Available settings that require recoverable setup SHALL remain discoverable with a destination that explains the prerequisite, without enabling it automatically. Availability SHALL be checked again when a result is activated.

#### Scenario: Accountless mode
- **WHEN** Plethora Cloud is unavailable
- **THEN** Account, hosted API, and Plethora Cloud sync controls are absent from Settings search
- **AND** supported local or independently configured third-party settings remain discoverable

#### Scenario: Unsupported platform
- **WHEN** a setting is not exposed on the current platform
- **THEN** search does not offer it as a destination

#### Scenario: Recoverable prerequisite
- **WHEN** an available provider-specific setting requires provider configuration or an existing feature to be enabled
- **THEN** search can lead to the existing configuration or prerequisite explanation
- **AND** the prerequisite is not changed simply by selecting the result

### Requirement: Search navigation preserves context and existing back behavior

The query and results SHALL remain available while a user inspects a matched setting within the same Settings instance. On compact layouts, hierarchical back from a search destination SHALL restore the search results, prior result scroll position, and focus on the originating result. Existing app-return, system-back, and unsaved-change behavior SHALL remain in force. Declining a navigation confirmation SHALL preserve the current view and pending edits.

#### Scenario: Compact return to results
- **WHEN** a compact-layout user searches, opens a result, and invokes hierarchical back
- **THEN** the same query and results are restored at their previous scroll position
- **AND** keyboard or assistive focus returns to the result that was opened

#### Scenario: Desktop inspection
- **WHEN** a desktop user opens a result
- **THEN** the query and result list remain available alongside the setting

#### Scenario: Cancel navigation with pending edits
- **WHEN** a user with pending changes selects a result that would leave the current editing context and declines the discard confirmation
- **THEN** the current editing context, pending values, query, and result state remain unchanged

#### Scenario: Back behavior remains hierarchical
- **WHEN** a user invokes supported visible, gestural, or system back navigation from a search destination
- **THEN** the existing Settings hierarchy and unsaved-change protection are applied
- **AND** the persistent app-return control still returns directly to the prior app location

### Requirement: Search controls and result feedback are accessible

The search field and clear-search control SHALL have localized accessible names and visible keyboard focus. Results SHALL support standard keyboard activation, expose their label and path to assistive technology, and remain usable with touch. Result count and no-results changes SHALL be announced without moving focus as the user types. Clearing search SHALL return focus to the search field. Target emphasis SHALL remain identifiable without animation or color alone and SHALL respect reduced motion and E-Ink presentation.

#### Scenario: Keyboard search and activation
- **WHEN** a user types in the search field, tabs to a result, and activates it with Enter or Space
- **THEN** the corresponding destination opens with the same behavior as pointer activation

#### Scenario: Clear search
- **WHEN** a user activates the named clear-search control
- **THEN** the query is cleared, normal category navigation returns, and the search field receives focus

#### Scenario: No matching setting
- **WHEN** a nonblank query has no results
- **THEN** the query remains editable and a localized no-results message offers clear-search recovery to browse all settings
- **AND** search does not fabricate a destination

#### Scenario: Reduced motion or E-Ink
- **WHEN** a search result is opened with reduced motion or E-Ink presentation active
- **THEN** the target is revealed without relying on animated scrolling or a pulse
- **AND** its emphasis includes a non-color visual cue

### Requirement: Matching is local and does not search private values

Search matching SHALL operate locally without an AI provider, network search service, account, or persisted query history. It SHALL search setting definitions and shipped terminology rather than user-entered secrets, endpoints, private documents, or configuration values. Search itself SHALL remain usable offline for settings whose UI is available locally.

#### Scenario: Offline search
- **WHEN** the device is offline and Settings is available
- **THEN** users can search the available Settings catalog and navigate to locally available controls

#### Scenario: Private values are excluded
- **WHEN** a user searches for a value stored in an API key field or another private configuration field
- **THEN** that stored value does not cause a result to match and is not exposed in result text
- **AND** searching the field's descriptive label, such as "API key", still finds the relevant configuration
