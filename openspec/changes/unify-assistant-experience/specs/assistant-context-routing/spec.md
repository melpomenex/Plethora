## Purpose

Make relevant reading context effortless to use while giving readers deterministic control over strict sources, library access, general discussion and the privacy of current and historical material.

## ADDED Requirements

### Requirement: Context attachments are visible and controllable

Ordinary conversations SHALL default to context-aware Chat behavior, with active document, source-appropriate position and selected passage available as visible removable attachments. Chat, strict Document and strict Library policies SHALL remain accessible through secondary controls. An available attachment SHALL not be misrepresented as evidence actually received or used by the model. Removing optional context SHALL suppress its automatic reattachment for the same source revision in that conversation.

#### Scenario: General question on dashboard
- **GIVEN** there is no active source and no strict restriction
- **WHEN** the user asks who invented the transistor
- **THEN** the Assistant answers as general model knowledge without requiring a source or fabricated citations
- **AND** the thread and draft save normally

#### Scenario: Question unrelated to open paper
- **GIVEN** a PDF is available as optional context
- **WHEN** the user asks a general question unrelated to it
- **THEN** Chat answers without forcing evidence retrieval or source extraction
- **AND** source-origin labels do not falsely attribute the answer to the PDF

#### Scenario: Attachment removed
- **GIVEN** the current document chip is optional
- **WHEN** the user removes it and asks another question without changing that source revision
- **THEN** its content is not automatically attached again and historical turns keep their original provenance

### Requirement: Explicit restrictions take precedence over inferred intent

Routing SHALL apply authorization first, explicit source/collection restrictions next, explicit mentions and attachments next, explicit library/general actions next, and inferred context last. Strict Document/Library answers SHALL use only their allowed evidence. An invalid/empty restricted set SHALL fail closed with the question retained. Out-of-set mentions or inferred broadening SHALL require a visible restriction change rather than silently retrieving more sources. Unmatched ordinary questions SHALL fall back to Chat without automatic library or web access.

#### Scenario: Compare explicit documents
- **GIVEN** Auto policy, an attached PDF A and an eligible mentioned document B
- **WHEN** the user asks to compare this PDF with B
- **THEN** the submitted plan visibly contains A and B and retrieves only their eligible evidence
- **AND** collection limits remain enforced

#### Scenario: Strict source conflicts with mention
- **GIVEN** Only PDF A is the explicit restriction
- **WHEN** the user mentions B outside it
- **THEN** the UI preserves the question and offers an explicit Include B restriction change
- **AND** no request includes B before the user accepts the change

#### Scenario: Restrict to collection
- **GIVEN** a library question restricted to collection C
- **WHEN** semantic retrieval, lexical fallback or alternate retrieval runs
- **THEN** every source belongs to the authorized C subset
- **AND** an empty subset does not become a whole-library query

### Requirement: Source references resolve across turns without changing authority

Pinned selections and explicit section references SHALL remain available after transient highlights disappear. Ambiguous “this” references SHALL prefer the pinned selection then applicable active position; unique historical paper references SHALL resolve by saved source identity. Multiple plausible historical targets SHALL prompt correction rather than selecting arbitrarily. Source changes SHALL update only inferred attachments, preserve explicit restrictions and label the change. Earlier answers SHALL not be treated as fresh source evidence.

#### Scenario: Follow-up after selection disappears
- **GIVEN** the prior turn discussed a captured selected paragraph
- **WHEN** its highlight disappears and the user asks for a simpler example
- **THEN** the same captured selection and its authorized source remain the primary reference
- **AND** the answer is saved to the same conversation with that provenance

#### Scenario: Current source changes
- **GIVEN** A was optional context and no strict lock exists
- **WHEN** the user opens B and asks about this document
- **THEN** the UI shows B as current and freezes B for that turn
- **AND** A's prior answers remain attributed to A

#### Scenario: Ambiguous earlier paper
- **GIVEN** two earlier cited papers are plausible targets
- **WHEN** the user asks about that paper without a unique referent
- **THEN** the draft is retained and a concise source choice is offered before retrieval

### Requirement: Source planning respects location and actual coverage

Source-specific requests SHALL carry document identity/title/type, selected excerpt, available position and relevant source content within the actual provider context budget. PDF page, EPUB section/CFI, article passage and media time SHALL not be interchanged. Whole-source and read-so-far requests SHALL use full or hierarchical context only when available and disclose omissions. Partial or unavailable transcripts, unreadable equations and missing positions SHALL not be presented as fully understood sources.

#### Scenario: PDF current page
- **GIVEN** the reader is on PDF page 12
- **WHEN** the user asks about this page
- **THEN** the submitted context identifies page 12 and uses its available text/selection plus permitted bounded support
- **AND** missing text/OCR or visual capability is described honestly with recovery while retaining the question

#### Scenario: EPUB chapter
- **GIVEN** the reader is in chapter 4 of an EPUB
- **WHEN** the user asks how it connects to chapter 3
- **THEN** context identifies both requested sections and retrieves/budgets their actual content
- **AND** citations retain section/CFI locations when available

#### Scenario: Full and partial video transcript
- **GIVEN** a video has an available complete transcript
- **WHEN** the user asks about its conclusion or a whole-video summary
- **THEN** planning can use relevant late passages or complete hierarchical coverage within budget
- **AND** if only a partial transcript is actually available the answer discloses its coverage and invents no unseen speech

### Requirement: Current and historical source authorization is revalidated

All source text and source-derived history, summaries, suggestions, embeddings, web queries, repair prompts and tool parameters SHALL respect current identity, visibility, collection ownership, AI exclusion, local-only settings and provider consent. Missing library metadata SHALL not authorize a hit. Legitimate unsaved viewer material SHALL require live ownership authority and remain local where applicable. Strict Local-Only SHALL prohibit off-device source/query processing even under alternate providers or fallback. General questions with no attached protected content SHALL remain usable.

#### Scenario: Historical source becomes private
- **GIVEN** an earlier answer contains material from a source now local-only or inaccessible
- **WHEN** the user continues with a cloud provider
- **THEN** restricted source-derived content is omitted from outgoing history and summaries with an honest unavailable indicator
- **AND** a strict follow-up requiring it stops before dispatch and offers permitted recovery

#### Scenario: Metadata disappears mid-request
- **GIVEN** a retrieved hit names a document whose authorization metadata cannot be loaded
- **WHEN** evidence is prepared for generation
- **THEN** that hit is denied and cannot become a cloud prompt or verified citation

#### Scenario: Local-only including embeddings and fallback
- **GIVEN** Strict Local-Only is enabled or a required source is local-only
- **WHEN** configured query embedding, suggestions or generation would use an off-device service
- **THEN** those dispatches do not occur and a permitted local/retrieval-only path or clear setup limitation is shown
- **AND** declining consent retains the draft without silently changing the source policy

### Requirement: Evidence gaps do not silently broaden sources

Grounded turns SHALL distinguish unavailable, unindexed, weak, absent, partial and conflicting evidence. They SHALL describe the actually examined subset and SHALL NOT claim exhaustive library coverage from selected chunks. General knowledge and web expansion SHALL be explicit permitted choices after insufficient strict evidence; external facts SHALL have distinct origin labels and real web citations only when lookup occurred.

#### Scenario: Missing embeddings or no matches
- **GIVEN** embeddings are unavailable or retrieval has no relevant matches
- **WHEN** a strict library question runs
- **THEN** permitted lexical results or an honest no-evidence state are shown with actual coverage
- **AND** no model-only or web answer is silently substituted

#### Scenario: Conflicting passages
- **GIVEN** two authorized sources disagree
- **WHEN** the Assistant answers the comparison
- **THEN** disagreement is visible with supporting passages from both sides and no retrieval score presented as certainty
