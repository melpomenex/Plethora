## ADDED Requirements

### Requirement: RSS article selection remains visible during context-menu interaction

In the RSS reader pane, full-content article view, and Story view, right-clicking a non-empty selection within the current article SHALL open the selection action menu while keeping that same passage visibly selected. Opening the menu, moving between its items, opening a submenu, and pressing a submenu item SHALL NOT collapse or replace the article selection before the chosen action receives its captured passage. Unrelated interface updates while the menu is open SHALL preserve this behavior.

#### Scenario: Right-click immediately after selecting

- **WHEN** the user selects a passage in any supported RSS article view and immediately right-clicks within the selected passage
- **THEN** the selection action menu opens and the original passage remains visibly selected until the user chooses an action or dismisses the menu

#### Scenario: Selection spans article formatting

- **WHEN** the user selects text across multiple paragraphs or inline formatting, in either selection direction, and right-clicks within it
- **THEN** the menu opens with the same text range visibly selected, without shrinking the selection to the clicked word or paragraph

#### Scenario: Highlight submenu keeps the passage selected

- **WHEN** the user opens the selection menu, moves to Highlight, and presses a color in its submenu
- **THEN** the passage stays visibly selected throughout menu navigation and the chosen color is applied to that passage

#### Scenario: Interface update while choosing an action

- **WHEN** article content is unchanged and an unrelated interface update occurs while its selection menu is open
- **THEN** the original passage remains visibly selected and available to the menu actions

### Requirement: RSS selection actions use the passage captured for that menu

Every RSS selection menu action SHALL receive the selected text and associated passage context captured when its menu opened. Focus changes caused by activating an action or opening its dialog SHALL NOT substitute an empty selection, menu label, or later selection. Existing action completion behavior, including clearing selection after successful extraction or highlighting, SHALL remain supported.

#### Scenario: Copy receives the selected passage

- **WHEN** the user clicks Copy in the RSS selection menu
- **THEN** the clipboard receives the originally selected text and the menu closes

#### Scenario: Dialog action receives the selected passage after focus changes

- **WHEN** the user chooses Add note or Create Flashcard and the action prepares its article document before opening a dialog
- **THEN** the dialog receives the originally selected text even if the browser selection changes after action activation

### Requirement: RSS selection menu lifecycle respects article and user intent

Pressing Escape SHALL dismiss the RSS selection menu without clearing an otherwise valid article selection, allowing the user to reopen the menu. Ordinary outside clicks and replacement text selections SHALL retain normal browser selection behavior. Changing the article or replacing its content SHALL dismiss its old selection menu and invalidate its retained selection. With no valid selection inside the current article, right-click SHALL preserve existing native behavior and SHALL NOT reopen a selection menu using previously captured text. Existing editable-field behavior and touch text-selection gestures SHALL be preserved.

#### Scenario: Escape allows the same selection to be used again

- **WHEN** the user presses Escape while the selection menu is open and then right-clicks the still-selected passage
- **THEN** the menu closes without clearing that selection and reopens for the same passage on the next right-click

#### Scenario: Outside click or new selection is respected

- **WHEN** the user clicks outside the selection menu or makes a new text selection
- **THEN** the menu dismisses and any selection subsequently cleared or replaced by the user is not restored to the old passage

#### Scenario: Article changes while the menu is open

- **WHEN** the user changes articles or the selected article content is replaced while its selection menu is open
- **THEN** that menu closes and the old selection cannot be restored or used by a later menu in the new content

#### Scenario: Right-click without an article selection

- **WHEN** the user right-clicks article text, a link, or an image with no valid selection in the current article
- **THEN** the RSS selection menu does not intercept the event and no stale passage is used

#### Scenario: Native editing and touch selection remain available

- **WHEN** the user right-clicks an editable field or uses a touch gesture to select article text
- **THEN** the existing native editing or touch selection behavior is preserved
