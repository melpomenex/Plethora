## MODIFIED Requirements

### Requirement: Three explicit user-selectable conversational scopes

The Assistant SHALL preserve Chat, strict Document and strict Library policies across supported surfaces. New ordinary conversations SHALL default to contextual Chat, showing optional available source attachments without requiring a top-level technical mode choice. An explicit document/library entry SHALL prepare the corresponding visible restriction. Source attachments and effective restrictions SHALL remain visible; the three policies SHALL be reachable through secondary source controls. Merely opening a document or video SHALL not silently impose a strict restriction. This requirement's presentation supersedes the earlier three adjacent top-level mode buttons; it does not remove any grounding policy.

#### Scenario: Newly opened Assistant defaults to Chat scope
- **WHEN** an ordinary new conversation opens over a document/video
- **THEN** the document/video is visible as optional context and Chat behavior applies without a mandatory mode choice

#### Scenario: Explicit Library Q&A entry point selects Library scope
- **WHEN** Ask about your library is activated
- **THEN** its prepared canonical conversation visibly targets the authorized library subset with Library grounding
- **AND** no question is submitted automatically
