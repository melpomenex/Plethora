## ADDED Requirements

### Requirement: Audio Edition queue items route to audio player

An item in the Queue that has a ready Audio Edition SHALL route its primary Queue action to the Audio Edition player (`listenToEdition: true`), and in Queue Scroll Mode SHALL render the audio player instead of the text document viewer.

#### Scenario: Opening Audio Edition item from Queue list
- **WHEN** the user triggers the primary action on an item with a ready Audio Edition in the Queue
- **THEN** the viewer opens in Audio Edition mode
- **AND** playback resumes from the saved listening location

#### Scenario: Audio Edition in Queue Scroll Mode
- **WHEN** Queue Scroll Mode presents an item that has a ready Audio Edition
- **THEN** the integrated Audio Edition player is rendered
- **AND** the visual text document viewer is not rendered in its place
