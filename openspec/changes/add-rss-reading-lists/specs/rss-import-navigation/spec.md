## MODIFIED Requirements

### Requirement: Folder and Category Feed Navigation
The system SHALL allow users to click folders or categories in the RSS sidebar to display combined articles from all feeds inside that folder or category, and SHALL additionally allow users to open RSS Scroll Mode scoped to a single folder or category section via a dedicated section-level affordance.

#### Scenario: Select folder in sidebar
- **WHEN** user clicks a folder section header in the sidebar
- **THEN** the folder SHALL be highlighted, and the article list SHALL display articles from all feeds nested in that folder

#### Scenario: Select category in sidebar
- **WHEN** user clicks a category section header in the sidebar
- **THEN** the category SHALL be highlighted, and the article list SHALL display articles from all feeds with that category

#### Scenario: Open Scroll Mode scoped to a section
- **WHEN** user activates the scroll-this-section affordance on a folder or category divider
- **THEN** the system SHALL open Scroll Mode scoped to the feeds in that section, and the Scroll Mode header SHALL display the section name

## ADDED Requirements

### Requirement: Section-Level Scroll Affordance
The system SHALL render a dedicated scroll affordance on each folder and category section divider in the RSS sidebar that opens Scroll Mode scoped to that section's feeds.

#### Scenario: Affordance is present on every section
- **WHEN** the RSS sidebar is rendered with one or more folder or category sections
- **THEN** each section divider SHALL display a scroll affordance that is keyboard-focusable and screen-reader labeled

#### Scenario: Affordance does not trigger on section header click
- **WHEN** the user clicks the section header text to view combined articles
- **THEN** the scroll affordance SHALL NOT be triggered, and only the article-list navigation SHALL occur
