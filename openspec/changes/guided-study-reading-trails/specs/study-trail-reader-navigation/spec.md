## Purpose

Let learners follow bounded assignments through existing document readers while keeping ordinary reading controls available.

## ADDED Requirements

### Requirement: Reader-confirmed passage resolution
The EPUB, PDF, HTML, and Markdown readers SHALL acknowledge exact passage presentation only after verifying both boundaries against current rendered text. They SHALL expose failure, ambiguity, stale and missing sources, and explicitly labeled coarse navigation where reliable.

#### Scenario: Duplicate quote or stale request
- **WHEN** multiple occurrences remain plausible or a newer request supersedes the current jump
- **THEN** the reader avoids choosing an arbitrary occurrence and superseded results do not change the active step.

#### Scenario: Scanned PDF without geometry
- **WHEN** a page can be opened but PDF text geometry is unavailable
- **THEN** the learner can open the page with an explanation of the coarse location.

### Requirement: Guided reader controls and entry points
The application SHALL provide plan and topic entry points to Study Mode. The reader SHALL visibly highlight the assigned text in the source document with the same prominent active-match treatment used for linked sources and mark its boundaries. The reader toolbar SHALL provide access to previous and next, explicit completion, and return controls through a menu that opens on demand. Learners SHALL be able to expand an assignment in the plan to read its full text and objectives before opening the reader. The application SHALL reuse document tabs and preserve ordinary reading after exit.

#### Scenario: Read a passage that spans pages
- **WHEN** a learner opens an assignment with several page segments
- **THEN** verified segments are highlighted in the document as their pages are displayed, with the start and end marked at the passage boundaries.

#### Scenario: Cross-document continuation
- **WHEN** the learner advances to a passage in another document, exits, and later resumes
- **THEN** the application focuses or opens the target document and requests the stored passage, respecting prerequisite order.
