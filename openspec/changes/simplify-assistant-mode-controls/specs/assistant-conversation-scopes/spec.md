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

## ADDED Requirements

### Requirement: One primary Assistant execution mode choice

Assistant presentations supporting Learning Agent SHALL expose one primary mode choice, `Chat` or `Learning Agent`, with exactly one selected mode and an accessible group label. Source policy SHALL be visually and semantically secondary to execution mode. Choosing a mode SHALL prepare the composer without submitting input. Ordinary Chat SHALL remain the default execution path. Learning Agent SHALL require explicit selection or its existing explicit entry-point handoff, and SHALL retain existing readiness, source validation, and proposal approval boundaries. While generation is active, mode and source changes SHALL be unavailable.

#### Scenario: Mode choice does not execute a request
- **WHEN** the user selects Learning Agent and then returns to Chat before submitting
- **THEN** the visible mode changes without creating messages, starting generation, or invoking tools
- **AND** the unsent draft and existing conversation artifacts remain intact

#### Scenario: Explicit Learning Agent palette handoff
- **WHEN** an existing Learning Agent command opens the Assistant
- **THEN** Learning Agent mode is visibly selected without automatically sending a request
- **AND** existing readiness and source checks still gate execution

#### Scenario: Unavailable agent explains recovery
- **WHEN** the user attempts to select or submit Learning Agent while its required capability is unavailable
- **THEN** localized existing recovery guidance explains the unmet prerequisite
- **AND** no agent run starts and no input is silently submitted as Chat

#### Scenario: Controls cannot change a running turn
- **WHEN** a Chat turn or agent run is generating
- **THEN** mode and source controls cannot alter that turn's execution path or source policy
- **AND** existing cancellation remains available

### Requirement: Mode-specific source controls preserve independent choices

In Chat mode, the Assistant SHALL display its current `Answer from` choice and applicable contextual attachments near the composer. In Learning Agent mode, the Assistant SHALL show its existing explicit agent sources, attachment actions, and source constraints in that area and SHALL omit the Chat source-policy control. Entering agent mode SHALL retain the last Chat source choice. Returning to Chat SHALL restore that visible choice without clearing the draft, messages, contextual attachments, or existing review artifacts. Agent execution SHALL continue to use its own validated explicit source contract rather than the hidden Chat source policy.

#### Scenario: Strict Chat choice survives agent mode
- **WHEN** the user selects `This document only` or `My library`, enters Learning Agent, and returns to Chat
- **THEN** the same Chat source choice reappears
- **AND** the message thread, draft, contextual attachments, and review artifacts remain available

#### Scenario: Agent sources do not imply a Chat restriction
- **WHEN** Learning Agent is selected after a strict Document Chat turn
- **THEN** the composer shows agent sources and omits `Answer from`
- **AND** submitting uses the existing agent source validation and approval workflow
- **AND** the hidden Chat policy is not presented as controlling the agent's sources

#### Scenario: Missing-evidence recovery changes the source choice
- **WHEN** a strict-source Chat answer offers expansion to general knowledge and the user accepts
- **THEN** the source control changes to `General knowledge` within Chat mode
- **AND** the recovery action describes using general knowledge without suggesting a change to Learning Agent
- **AND** no request is sent unless the existing explicit recovery action includes re-asking

### Requirement: Accessible source selection within each Assistant layout

Mode and source controls SHALL use localized visible labels, expose their current selections to assistive technology, support keyboard operation, and retain visible focus and selected indicators beyond color. Interactive targets SHALL be at least 40 CSS pixels and at least 48 CSS pixels on coarse pointers. Source options SHALL remain reachable at narrow supported sidebar/mobile widths, with the mobile keyboard open, at 200% zoom, and with translated labels. Menus SHALL fit their containing viewport or sheet and scroll internally when necessary. Dismissal SHALL return focus to the source trigger; Back or Escape SHALL close the source menu before closing the Assistant. Opening, selecting, or dismissing a source menu SHALL preserve the draft and attachments.

#### Scenario: Keyboard selects a source and returns focus
- **WHEN** the user opens `Answer from` using the keyboard, navigates its choices, and selects one
- **THEN** the active source changes with a visible and programmatically available selected indicator
- **AND** the menu closes and focus returns to the trigger
- **AND** the draft and attachments remain intact

#### Scenario: Source options stay inside the mobile sheet
- **WHEN** the Assistant is partial or expanded with the keyboard open and the source choices are opened
- **THEN** every option is reachable by scrolling and keyboard focus within the sheet's focus boundary
- **AND** Back or Escape closes the source choices before dismissing the Assistant

#### Scenario: Long labels remain usable
- **WHEN** the Assistant is displayed at its minimum supported width with a long translation or 200% zoom
- **THEN** controls wrap or use bounded scrolling without horizontal overflow, clipped choices, or overlapping input
- **AND** Chat and Learning Agent retain understandable visible labels and usable target sizes
