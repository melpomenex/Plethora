## ADDED Requirements

### Requirement: Knowledge Universe WebGL camera target auto-centering
The Knowledge Universe WebGL renderer SHALL automatically center the camera orbit target on the calculated galaxy home target whenever data changes or the canvas component is mounted/resized.

#### Scenario: User navigates to Knowledge Universe tab
- **WHEN** the user opens or resizes the Knowledge Universe view
- **THEN** the camera orbit target centers squarely on the node layout center rather than staying locked at origin or being pushed to screen corners
