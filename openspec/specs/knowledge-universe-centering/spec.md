# knowledge-universe-centering Specification

## Purpose
Users encountered several usability, filtering, and functional bugs in Issue #44: "Due All" filtering omitted learning items/extracts, NotebookLM displayed a connected status without rendering notebooks, the Knowledge Universe graph was off-center, Scroll Mode became stuck on an inescapable "Nothing to Read" state when filters were set to zero, "New Only" showed read/overdue documents, section mentions with # failed in document Q&A for EPUB Table.

## Requirements

### Requirement: Knowledge Universe WebGL camera target auto-centering
The Knowledge Universe WebGL renderer SHALL automatically center the camera orbit target on the calculated galaxy home target whenever data changes or the canvas component is mounted/resized.

#### Scenario: User navigates to Knowledge Universe tab
- **WHEN** the user opens or resizes the Knowledge Universe view
- **THEN** the camera orbit target centers squarely on the node layout center rather than staying locked at origin or being pushed to screen corners
