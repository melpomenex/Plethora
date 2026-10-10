## ADDED Requirements
### Requirement: Continuous EPUB Scrolling
The system SHALL render EPUB documents in a continuous vertical scroll flow in the web reader.

#### Scenario: User scrolls through an EPUB
- **WHEN** an EPUB document is opened in the web reader
- **THEN** the reader allows scrolling through all sections of the book without being limited to the first section

### Requirement: EPUB TOC Navigation
The system SHALL navigate to the selected EPUB table-of-contents item in the web reader.

#### Scenario: User selects a TOC entry
- **WHEN** the user clicks any TOC item in the EPUB TOC list
- **THEN** the reader scrolls to the corresponding section and updates the current location

#### Scenario: Android continuous flick
- **WHEN** a user swipes vertically inside a continuous EPUB iframe
- **THEN** native scrolling continues without programmatic page or chapter turns, while horizontal Android back gestures remain available

#### Scenario: Genuine paginated gesture
- **WHEN** a user swipes vertically in paginated mode without an active selection or interactive target
- **THEN** legitimate previous/next page navigation remains available

#### Scenario: Fragment heading and latest selection
- **WHEN** a TOC item includes a fragment identifier and multiple selections resolve asynchronously
- **THEN** the latest selection reaches its actual heading with small visible padding and older requests cannot move the viewport

#### Scenario: User interruption and delayed layout
- **WHEN** the user scrolls backward or forward, or chapter/image/font/viewport layout changes after navigation
- **THEN** stale CFIs and delayed resize corrections cannot restore a previously viewed location; direct input interrupts pending automatic navigation
