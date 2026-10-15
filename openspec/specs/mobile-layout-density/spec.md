# mobile-layout-density Specification

## Purpose
The PWA mobile UI feels spacious and the reading view does not yet feel premium or efficient on small screens. Improving typography, spacing, and information density will make reading feel more refined and allow users to see more content without sacrificing readability.

## Requirements

### Requirement: Mobile density profile for PWA
The system SHALL provide a compact mobile density profile for the PWA that reduces excess spacing while preserving touch accessibility.

#### Scenario: Compact layout on a phone
- **WHEN** a user opens the PWA on a phone-sized viewport
- **THEN** primary layouts use the mobile density profile
- **AND** interactive controls preserve a minimum 44px tap target

### Requirement: Compact mobile information layouts
The system SHALL present mobile lists, cards, and headers in a compact layout that increases visible information without sacrificing legibility.

#### Scenario: Denser information in list views
- **WHEN** a user views a list or dashboard on a phone
- **THEN** the layout shows more items than the current default spacing
- **AND** text remains readable without horizontal scrolling
