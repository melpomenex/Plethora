# queue-close-tactile-click Specification

## Purpose
Provides responsive, satisfying tactile motor click feedback when the user closes out the Queue on mobile touch devices.

## Requirements

### Requirement: Tactile motor click on mobile queue close
The application SHALL deliver a tactile motor click (the semantic `activation` haptic effect) when the user taps the close ("x") button on mobile Queue surfaces, including exiting full-screen Queue Scroll Mode.

#### Scenario: User taps close button in Queue Scroll Mode
- **WHEN** user taps or presses the close ("x") button in Queue Scroll Mode on a supported mobile device with haptics enabled
- **THEN** the system emits the `queue.closed` feedback event, triggers the `activation` tactile motor effect, and closes the Queue view.

#### Scenario: Haptics disabled in settings
- **WHEN** user taps the close ("x") button in Queue Scroll Mode when haptic feedback is disabled in user settings
- **THEN** the system closes the Queue view without triggering motor vibration.

#### Scenario: Unsupported hardware or desktop platform
- **WHEN** user activates the queue close button on desktop or on a device without haptic motor hardware
- **THEN** the system closes the Queue smoothly without runtime errors or unwanted side effects.

### Requirement: Touch-down responsive feedback
The application SHALL emit the tactile interaction upon user press (`pointerdown` or tap) on the close button to provide immediate mechanical confirmation coincident with the finger press.

#### Scenario: Immediate touch-down confirmation
- **WHEN** user presses down on the queue close button
- **THEN** tactile feedback is admitted and performed immediately without waiting for modal dismiss animation or teardown to complete.
