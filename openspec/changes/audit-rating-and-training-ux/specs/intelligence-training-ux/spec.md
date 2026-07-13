## ADDED Requirements

### Requirement: Training Feedback Consistency
Every intelligence-training action across all entry points (quick-train buttons, context menu, walkthrough mode) SHALL provide immediate multi-sensory feedback — visual pulse, auditory cue, and haptic — consistent with the gold-standard pattern established by the RSS scroll-mode quick-train.

#### Scenario: User trains via quick-train thumbs button
- **WHEN** the user taps the thumbs-up or thumbs-down button on an article in RSS scroll mode
- **THEN** the system plays a distinct sound (like-sound for positive, dislike-sound for negative)
- **AND** fires haptic feedback
- **AND** visually pulses the pressed button
- **AND** shows a toast confirming the training action with an undo option

#### Scenario: User trains via context menu
- **WHEN** the user selects "Like author" or "Dislike author" (or keyword/tag) from the TrainingMenu context menu
- **THEN** the system provides the same multi-sensory feedback (sound, haptic, visual confirmation, toast with undo) as the quick-train buttons
- **AND** the menu closes after the action completes

#### Scenario: User trains via walkthrough mode
- **WHEN** the user clicks Like or Dislike in the SiteBySiteTraining walkthrough
- **THEN** the system provides multi-sensory feedback (sound, haptic) before advancing to the next article

#### Scenario: Sound effects disabled by user preference
- **WHEN** the user has disabled UI sound effects in settings
- **AND** the user performs a training action
- **THEN** no sound is played
- **AND** haptic and visual feedback are still provided

### Requirement: Undo for Training Actions
Every training action that creates a classifier SHALL offer an undo mechanism via a toast action button that removes the just-created classifier.

#### Scenario: User undoes a training action
- **WHEN** the user performs a training action (quick-train, context menu, or walkthrough)
- **THEN** a toast appears with an "Undo" action button
- **AND** the toast remains visible for at least 6 seconds
- **WHEN** the user clicks "Undo"
- **THEN** the system removes the just-created classifier via `removeClassifier`
- **AND** intelligence scores are recomputed
- **AND** a confirmation toast appears indicating the training was undone

#### Scenario: User does not undo
- **WHEN** the undo toast auto-dismisses after its timeout
- **THEN** the classifier remains persisted and no further action is taken

### Requirement: Already-Trained State Indicator
The quick-train thumbs buttons SHALL visually indicate whether the current article's trainable value (author or tag) is already part of an existing classifier, and in which sentiment direction.

#### Scenario: Article author is already liked
- **WHEN** the current article's author matches an existing "like" classifier
- **THEN** the thumbs-up button displays in a filled/active state
- **AND** the thumbs-down button displays in its default/outline state

#### Scenario: Article author is already disliked
- **WHEN** the current article's author matches an existing "dislike" classifier
- **THEN** the thumbs-down button displays in a filled/active state
- **AND** the thumbs-up button displays in its default/outline state

#### Scenario: Article author is not yet trained
- **WHEN** the current article's author does not match any existing classifier
- **THEN** both thumbs buttons display in their default/outline state

### Requirement: Internationalization of Training Surfaces
All user-facing strings in intelligence-training UI components SHALL be internationalized through the translation system, covering all supported languages (en, zh, de, es, fr, ja).

#### Scenario: Training menu labels are translated
- **WHEN** the user opens the TrainingMenu in a non-English locale
- **THEN** the header ("Train Intelligence"), action labels ("Like author", "Dislike author", "Like keyword", "Dislike keyword", "Like tag"), keyword input placeholder, and all tooltips are displayed in the active locale's language

#### Scenario: Manage Training view labels are translated
- **WHEN** the user opens the ManageTrainingView in a non-English locale
- **THEN** the header, search placeholder, filter labels, group headers ("Liked", "Disliked"), save button, and all status messages are displayed in the active locale's language

#### Scenario: Quick-train toast messages are translated
- **WHEN** the user performs a quick-train action in a non-English locale
- **THEN** the toast title ("Liked" / "Disliked"), detail text, error messages, and undo button label are displayed in the active locale's language

#### Scenario: Walkthrough mode is translated
- **WHEN** the user opens SiteBySiteTraining in a non-English locale
- **THEN** all button labels, the progress indicator, and the completion screen message are displayed in the active locale's language

### Requirement: Manage Training Save Button Correctness
The ManageTrainingView bulk-save button SHALL display a localized text label (e.g. "Save"), not the raw icon component name.

#### Scenario: Save button label
- **WHEN** the user has pending sentiment changes in ManageTrainingView
- **THEN** the save button displays a save icon alongside a localized "Save" text label
- **AND** the literal string "FloppyDisk" does NOT appear anywhere in the rendered UI

### Requirement: Manage Training Empty State
The ManageTrainingView SHALL display a helpful empty state when no classifiers exist, guiding the user toward their first training action.

#### Scenario: No classifiers trained yet
- **WHEN** the user opens ManageTrainingView and the classifier list is empty (not loading)
- **THEN** the view displays an empty-state message explaining that no training exists yet
- **AND** the message guides the user to use thumbs-up/thumbs-down buttons on articles to train their intelligence

### Requirement: Manage Training Save Confirmation
The ManageTrainingView SHALL provide visual confirmation when a bulk save succeeds.

#### Scenario: Bulk save succeeds
- **WHEN** the user clicks Save and the batch update completes successfully
- **THEN** a success toast or inline confirmation is displayed
- **AND** the pending changes count resets to zero
- **AND** the Save button returns to its disabled state
