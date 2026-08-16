## ADDED Requirements

### Requirement: Mobile PDF toolbar keeps edge clearance
On phone form factors, the PDF reader toolbar (including the original/reflow toggle at its leading edge and the page/zoom cluster at its trailing edge) SHALL keep a minimum horizontal clearance of 12px from the screen edge, increasing to the device's horizontal safe-area inset (notch/rounded corner) when that inset is larger, in both portrait and landscape orientations.

#### Scenario: Portrait phone
- **WHEN** the PDF viewer renders its toolbar on a phone in portrait where horizontal safe-area insets are zero
- **THEN** the leftmost and rightmost toolbar controls sit at least 12px from the screen edges

#### Scenario: Landscape phone with notch
- **WHEN** the device is rotated to landscape and the platform reports a nonzero `safe-area-inset-left` or `safe-area-inset-right`
- **THEN** the toolbar's horizontal padding expands to that inset so no control is clipped or drawn into the notch area

### Requirement: DocumentViewer mobile compact toolbar honors the same clearance
The DocumentViewer mobile compact toolbar shown above PDF documents SHALL apply the same minimum horizontal clearance and safe-area expansion as the PDF reader toolbar.

#### Scenario: Compact toolbar spacing
- **WHEN** a PDF document is open on a phone and the compact toolbar renders with its right-side action cluster
- **THEN** the cluster's trailing control keeps at least 12px clearance from the screen edge (or the safe-area inset when larger)

### Requirement: Toolbar auto-hide behavior is preserved
The safe-area padding change SHALL NOT alter the toolbar's auto-hide translation, its touch-target sizes, or the positioning of menus anchored to it.

#### Scenario: Chrome auto-hide still works
- **WHEN** the phone PDF chrome hides and reappears during reading
- **THEN** the toolbar slides fully out of and back into view with the new padding applied, and 44px minimum touch targets remain
