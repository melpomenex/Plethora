## Purpose

Defines the stacking isolation, solid opacity, and responsive overlay behavior of the compact tag editing popover and sheet, ensuring it remains legible and unobstructed by surrounding UI elements.

## ADDED Requirements

### Requirement: Stacking Isolation and Solid Opacity
The tag editor overlay SHALL render with a guaranteed solid, fully opaque background surface (enforcing solid opaque popover colors across all active themes) and SHALL be isolated from ancestor or sibling stacking contexts (such as virtualized list rows using CSS transforms) so that no underlying content, text, or buttons draw over the editor interface.

#### Scenario: Editing tags in transformed or virtualized rows
- **WHEN** the user opens the tag editor on an item inside a virtualized list row or document card
- **THEN** the tag editor displays with complete opacity, and no underlying card or row content bleeds through or renders on top of the editor

### Requirement: Mobile Responsive Sheet Presentation
When opened on mobile viewports or touch devices, the tag editor SHALL present as a portaled overlay or responsive sheet anchored to the viewport rather than an unconstrained inline box, preventing horizontal clipping at screen edges and ensuring safe-area compatibility.

#### Scenario: Mobile tag editor activation
- **WHEN** the user taps to edit tags on a mobile viewport
- **THEN** the tag editor renders within viewport boundaries with tap-away dismissal and clear, unobstructed visibility of all existing tags and the tag input control
