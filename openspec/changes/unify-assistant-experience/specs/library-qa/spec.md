## MODIFIED Requirements

### Requirement: Questions resolve to passage, document, or library scope

Every submitted question SHALL have one visible effective source policy: contextual Chat, strict selected passage/document evidence, or strict library evidence within optional document/collection restrictions. Passage, document and library targeting SHALL be represented by attachments and secondary strict-source controls rather than requiring a technical mode choice before ordinary conversation. An explicit passage-only restriction SHALL use only that captured passage without library retrieval; strict Document and Library questions SHALL retrieve permitted supporting evidence when needed. General Chat SHALL not require source evidence. Removing overrides SHALL reveal the base policy, never silently broaden an explicit restriction.

#### Scenario: Scope picker changes retrieval breadth
- **GIVEN** the user has an explicit passage-only restriction
- **WHEN** they deliberately change the source control to My library and submit the same question
- **THEN** the visible policy changes and retrieval uses the authorized library subset rather than only the selected passage

#### Scenario: Passage scope uses only the selected text
- **GIVEN** the selected passage is the explicit only-source restriction
- **WHEN** the user asks a question
- **THEN** no library retrieval is performed and the answer is grounded only in the captured passage
- **AND** unavailable evidence yields an honest limitation without general-knowledge substitution

#### Scenario: Ordinary contextual question needs no mode choice
- **GIVEN** a new ordinary conversation with an active document attachment
- **WHEN** the user asks about it without choosing a strict mode
- **THEN** relevant source context is available and its actual use is disclosed
- **AND** a later general question can be answered conversationally in the same thread

### Requirement: Answers cite deep-linkable sources

All answer presentations SHALL preserve the same validated citation identity, original reference number, supporting quote, document title, available page/section/timestamp locator and answer-claim association. Inline indicators SHALL open accessible source details with expandable quotations and exact navigation when verified. Library, selection and external sources SHALL have distinct provenance; model knowledge SHALL not gain fabricated citations. Removing invalid references SHALL not renumber surviving references. Unverified or ambiguous locations SHALL display a stated limitation and SHALL NOT jump to an arbitrary nearby passage. Source navigation SHALL preserve a return path to the conversation and original reading state.

#### Scenario: Library answer cites its sources
- **GIVEN** a Library answer uses passages from two documents
- **WHEN** the user inspects its inline references and supporting source details
- **THEN** both actual sources and verified quotations are shown with their available locations
- **WHEN** the user activates a verified source
- **THEN** the reader opens that document at the cited passage and offers return to the same conversation

#### Scenario: Filtering does not renumber citations
- **GIVEN** a prompt numbered sources 1 through 4 and only source 3 survives validation
- **WHEN** the answer is rendered, copied and reloaded on any supported presentation
- **THEN** its surviving inline marker and source detail both retain number 3
- **AND** invalid markers do not become actionable source links

#### Scenario: Exact source is ambiguous or removed
- **GIVEN** a quote repeats in multiple places without a verifying locator or the source was deleted
- **WHEN** the user inspects the reference
- **THEN** its uncertainty/unavailability is visible and no exact jump is offered
- **AND** preserved local conversation state remains recoverable

#### Scenario: Source navigation returns to reading
- **GIVEN** a PDF reader is at page 12 and a conversation is scrolled to a cited answer with a draft
- **WHEN** the user explores a citation at another location and returns
- **THEN** the same thread, answer scroll, draft and original reader position restore where available
- **AND** temporary exploration does not silently commit a new reading position
