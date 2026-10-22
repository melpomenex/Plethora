## MODIFIED Requirements

### Requirement: Three explicit user-selectable conversational scopes

The Assistant SHALL preserve the `Chat`, `Document`, and `Library` conversational source policies while presenting them through a secondary `Answer from` control beside the Chat composer. The visible choices SHALL be `General knowledge`, `This document only`, and `My library`, respectively, with localized equivalents. `General knowledge` SHALL explain that attached context can supplement general knowledge; `This document only` SHALL communicate strict grounding in the current source; `My library` SHALL communicate retrieval across permitted library sources. The active choice SHALL remain visible when the control is closed. The source choices SHALL NOT be rendered as a second top-level mode switch or label the source choice `Chat`.

The `Chat` source policy SHALL remain the default for newly created ordinary conversations unless launched from an explicit entry point that targets strict document or library Q&A. The active source policy SHALL NOT automatically switch to `Document` merely because a document or video is open. Selection-sheet and Document Q&A source controls SHALL use the same source terminology and preserve their existing entry defaults and source subsets. Source labels SHALL NOT imply a change to existing grounding, retrieval, citation, or web-access permissions.

#### Scenario: Newly opened Assistant defaults to Chat scope
- **WHEN** the user opens a document or video and opens a new Assistant conversation without selecting a strict Q&A entry point
- **THEN** the source control displays `Answer from: General knowledge`
- **AND** the active document or video is shown as contextual grounding rather than a strict conversational boundary
- **AND** the source choices do not appear as another mode switch in the header

#### Scenario: Explicit Library Q&A entry point selects Library scope
- **WHEN** the user activates "Ask about your library" from the command palette
- **THEN** the conversation opens with `Answer from: My library` selected and visible
- **AND** its existing permitted library subset is preserved
- **AND** opening the conversation does not submit a question

#### Scenario: Reader chooses strict document grounding
- **WHEN** the user selects `This document only` from the source control
- **THEN** subsequent Chat submissions use the existing strict Document policy
- **AND** the selected restriction and current source remain visible beside the composer
- **AND** missing source evidence does not cause silent broadening to general knowledge

#### Scenario: Source terminology is consistent across presentations
- **WHEN** the user opens source choices in the Assistant, a selection Ask sheet, or Document Q&A
- **THEN** the same three localized choice labels represent the same three source policies
- **AND** choosing `My library` preserves any existing explicit library source subset

#### Scenario: Existing saved source choices reopen
- **WHEN** an existing conversation with a saved Chat, Document, or Library source policy is restored
- **THEN** the corresponding new source label is displayed without changing its stored policy, messages, draft, or learning artifacts
