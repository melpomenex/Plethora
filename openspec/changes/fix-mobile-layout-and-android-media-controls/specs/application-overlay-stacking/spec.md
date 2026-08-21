# Application Overlay Stacking

## ADDED Requirements

### Requirement: Top-level modal surfaces SHALL render above application navigation chrome

Any full-screen/top-level modal or overlay SHALL stack above persistent application chrome, including the mobile bottom navigation. New overlays SHALL use the application's centralized overlay stacking tokens (`--overlay-backdrop-z` / `--overlay-sheet-z`) or the shared overlay/dialog primitives that consume them; introducing new arbitrary z-index values for top-level overlays is prohibited.

#### Scenario: A modal is opened while the mobile bottom navigation is visible

- **WHEN** a top-level modal opens on a phone with the bottom navigation shown
- **THEN** the modal and its backdrop render above the navigation and the navigation cannot intercept touches intended for the modal

#### Scenario: A new overlay is added by a future change

- **WHEN** a developer adds a new full-screen overlay
- **THEN** the implementation uses the centralized overlay tokens or shared primitive rather than a bespoke z-index constant

### Requirement: High-level dialogs SHALL mount through a portal root

Full-screen dialogs SHALL render through a portal to the document body (or the shared overlay layer) so that transformed/stacked ancestor contexts cannot trap them below application chrome or iframes.

#### Scenario: The dialog is mounted deep inside a transformed viewer tree

- **WHEN** a dialog is opened from within a component subtree that has transforms or its own stacking context
- **THEN** the dialog still paints above all application chrome because it is portaled to the document root

### Requirement: Overlay dismissal, focus, and accessibility SHALL follow the shared contract

Top-level overlays SHALL provide focus trapping and restoration, Escape/back dismissal consistent with the application's existing overlay behavior, screen-reader-accessible labeling, and minimum comfortable touch targets for interactive elements. Visible keyboard focus SHALL be preserved.

#### Scenario: The user dismisses a modal with the system back/Escape affordance

- **WHEN** the user presses Escape on desktop or dismisses the overlay per the shared dismissal contract
- **THEN** the modal closes, focus returns to the invoking element, and underlying content regains interaction

#### Scenario: A screen reader enumerates the dialog

- **WHEN** an assistive technology user navigates into the open modal
- **THEN** the dialog exposes its role and labeled actions, and every action remains reachable and operable regardless of viewport width or text scale
