## ADDED Requirements

### Requirement: Session markers do not require finalized text
Recorded-session Important, Confusing, Recent Extract and Card Candidate actions SHALL store measured audio positions even before a transcript exists. Text-dependent actions SHALL remain pending until exact source evidence resolves; live captions SHALL NOT masquerade as verbatim extracts.

#### Scenario: Recent extract before transcription
- **WHEN** Save Recent Extract is invoked with no finalized transcript
- **THEN** a pending audio bookmark is saved and later resolves to validated source text without placeholder extract content

### Requirement: Shared transcript selection and source return
Canonical session transcript selection SHALL support exact extracts and card drafts through shared source-navigation contracts. Open in Source SHALL use validated segment/range evidence and seek associated media only when real alignment and media exist. Coarse/stale/missing-source outcomes SHALL be transparent and preserve return context.

#### Scenario: Card to recording
- **WHEN** the user chooses Open in Source on an accepted session card with valid media timing
- **THEN** the session opens the cited transcript segment and seeks the associated recording position, with a route back to review

#### Scenario: No valid audio alignment
- **WHEN** source evidence has text but no valid timing
- **THEN** navigation opens the verified paragraph/section or document without a precise playback claim

### Requirement: Summary and quotation remain distinct
Session extracts SHALL preserve actual source wording; generated summaries and user paraphrases SHALL be labeled separately. Transcript corrections SHALL NOT silently overwrite accepted extracts/cards.

#### Scenario: AI paraphrase offered as quotation
- **WHEN** proposed extract text differs from the cited canonical passage
- **THEN** it cannot be saved as a verbatim extract and is offered only as a labeled note/summary or corrected source selection
