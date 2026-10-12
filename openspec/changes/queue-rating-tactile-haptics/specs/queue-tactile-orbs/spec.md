## Purpose

Provides immersive, grade-differentiated tactile haptic feedback and physics-linked micro-interactions for the floating Rating Orbs and document rating surfaces within Queue mode.

## ADDED Requirements

### Requirement: Grade-Differentiated Tactile Signatures
The system SHALL deliver distinct physical haptic sensations corresponding to each rating grade (Again, Hard, Good, Easy) and Dismissal when rating a document in Queue.

#### Scenario: Rating Again triggers warning resistance sensation
- **WHEN** the user selects rating 1 ("Again") for a document in Queue
- **THEN** the system SHALL emit a heavy, warning-style tactile haptic impulse ("warning") indicating the document will be rescheduled for immediate review

#### Scenario: Rating Hard triggers firm resistance snap
- **WHEN** the user selects rating 2 ("Hard") for a document in Queue
- **THEN** the system SHALL emit a firm, resistant tactile snap ("commit") confirming deliberate cognitive effort

#### Scenario: Rating Good triggers crisp success pulse
- **WHEN** the user selects rating 3 ("Good") for a document in Queue
- **THEN** the system SHALL emit a crisp, clean success confirmation pulse ("success") signifying smooth progress

#### Scenario: Rating Easy triggers celebratory double-pulse
- **WHEN** the user selects rating 4 ("Easy") for a document in Queue
- **THEN** the system SHALL emit an uplifting, buoyant celebration pulse ("celebration") rewarding rapid mastery

#### Scenario: Dismissing a document triggers sharp clip
- **WHEN** the user selects the Dismiss orb for a document in Queue
- **THEN** the system SHALL emit a sharp, decisive clip ("activation") confirming dismissal from current queue flow

### Requirement: Rating Orb Touch Dynamics and Depression
The system SHALL deliver immediate micro-haptic tactile feedback upon pointer-down/touch-start on any Rating Orb, simulating the physical depression of a mechanical or glass control.

#### Scenario: User depresses a Rating Orb
- **WHEN** the user initiates touch-down or pointer-down on a Rating Orb
- **THEN** the system SHALL immediately emit a subtle tactile tick ("selection") concurrent with visual compression feedback

#### Scenario: User drags finger away before release
- **WHEN** the user presses down on an orb but slides their touch outside the button bounds before release
- **THEN** the system SHALL cancel the pending rating action without emitting the rating completion haptic

### Requirement: Floating Orb Rail Dragging and Magnetic Snapping
The system SHALL emit tactile detents when the draggable Rating Orbs rail crosses magnetic snap thresholds and docks against a screen edge.

#### Scenario: Dragging crosses edge proximity threshold
- **WHEN** the user drags the floating Rating Orbs rail across a proximity threshold into a new screen quadrant (left, right, top, or bottom)
- **THEN** the system SHALL emit a tactile detent ("threshold") to signal the new snap target

#### Scenario: Releasing and docking the rail
- **WHEN** the user releases the dragged Rating Orbs rail to dock at a chosen screen edge
- **THEN** the system SHALL emit a firm docking confirmation tick ("activation") as the rail snaps into resting position

### Requirement: Queue Rating Milestone Celebrations
The system SHALL emit celebratory tactile patterns when the user reaches document review session milestones or clears the reading queue.

#### Scenario: Reaching a review streak milestone in Queue
- **WHEN** the user rates a document that crosses a session milestone (such as 5 or 10 documents reviewed in session)
- **THEN** the system SHALL emit a celebratory multi-pulse haptic pattern ("celebration") after the grade confirmation

#### Scenario: Queue session completion
- **WHEN** the user rates the final pending document in the Queue
- **THEN** the system SHALL emit a session completion tactile sensation ("completion")

### Requirement: Tactile Settings and Hardware Gating
Tactile feedback for Queue document ratings MUST strictly respect user haptics enablement and intensity settings, and MUST fail silently on unsupported hardware or when disabled.

#### Scenario: Haptics disabled in settings
- **WHEN** `settings.haptics.enabled` is false
- **THEN** no tactile feedback SHALL be emitted on orb press, drag, dock, or document rating

#### Scenario: Intensity scaling
- **WHEN** `settings.haptics.intensity` is set to "subtle", "standard", or "strong"
- **THEN** native motor output amplitude and duration SHALL scale in accordance with the configured intensity
