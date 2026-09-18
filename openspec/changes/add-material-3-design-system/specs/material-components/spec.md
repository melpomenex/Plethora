## Purpose

Defines the Material 3 primitive component library that serves Plethora's frequently used controls, including variant/state behavior, accessibility guarantees, and the surface-selection rules (Dialog vs Sheet vs Menu vs Snackbar) that keep application feedback consistent.

## ADDED Requirements

### Requirement: Button variants

The design system SHALL provide a button primitive with Material 3 variants: filled (primary), tonal (secondary-container), outlined, text, and destructive (error), plus size options including icon-only. All variants SHALL use semantic tokens exclusively, SHALL expose the standard state layers, and SHALL meet a 40px minimum touch target at default size.

#### Scenario: Variant tokens

- **WHEN** each button variant renders
- **THEN** its fill, content, and border colors come from semantic role tokens (e.g. tonal uses `secondary-container`/`on-secondary-container`) and no variant hardcodes a color literal

#### Scenario: Legacy alias compatibility

- **WHEN** existing code instantiates the pre-existing `ActionButton` with `variant="primary"|"secondary"|"tertiary"|"destructive"`
- **THEN** it renders as the corresponding Material variant without any call-site changes

### Requirement: Chip

The design system SHALL provide chip primitives (assist, filter/input with selected state, suggestion) with leading icon/trailing content slots, token-based outline or tonal styling, and selected state that is communicated by more than color alone (checkmark or tonal fill plus `aria-pressed`).

#### Scenario: Filter chip selection

- **WHEN** a filter chip is selected
- **THEN** it shows a leading checkmark icon and a tonal fill, and exposes `aria-pressed="true"`

### Requirement: Segmented button

The design system SHALL provide a segmented button primitive for mutually exclusive or multi-select choices, with selected segments indicated by tonal fill and a checkmark icon (not color alone), full keyboard arrow navigation between segments, and support for icon+label segments.

#### Scenario: Keyboard navigation

- **WHEN** focus is on one segment and Right/Left arrow is pressed
- **THEN** focus moves to the adjacent enabled segment and selection follows with Tab-per-Material behavior (roving selection)

### Requirement: Switch, Checkbox, Radio, Slider

The design system SHALL provide Switch (adopting the existing accessible implementation), Checkbox, Radio, and Slider primitives styled from tokens, each exposing correct ARIA semantics, 40px+ interactive targets, visible focus, and labels bound via `htmlFor`/`id` or `aria-label`.

#### Scenario: Slider keyboard control

- **WHEN** a slider handle has keyboard focus and Arrow keys are pressed
- **THEN** the value changes by the step and live updates are announced via `aria-valuenow`

### Requirement: Text and search fields

The design system SHALL provide token-styled text field and search field primitives with label, placeholder, error, and disabled states, using the existing theme's surface/outline tokens. Existing raw `<input>` call sites in migrated surfaces SHALL be replaced by these primitives or by token-styled native inputs sharing the same classes.

#### Scenario: Error state

- **WHEN** a text field is in the error state
- **THEN** it indicates the error via the error-container role and supporting text, not color alone (icon or text message present)

### Requirement: Menus and list items

The design system SHALL provide menu and list-item primitives (with leading/trailing icon slots, destructive variant, section dividers, disabled state, keyboard navigation with Escape/Arrow keys, and typeahead where lists are long) and existing hand-rolled menu implementations in migrated surfaces SHALL be replaced by them.

#### Scenario: Menu keyboard dismissal

- **WHEN** a menu is open and Escape is pressed
- **THEN** the menu closes and focus returns to its trigger

### Requirement: Dialog consolidation

The design system SHALL provide a single dialog primitive (with alert/basic/full-width variants, focus trap, focus restore, Escape dismissal, backdrop scrim, and token elevation) and the existing imperative modal store, declarative confirm dialog, and ad-hoc fixed-overlay dialogs in migrated surfaces SHALL converge onto it so visual behavior is defined in one place.

#### Scenario: Focus management

- **WHEN** a dialog opens
- **THEN** focus moves into the dialog, Tab cycles within it, and on close focus returns to the element that opened it

#### Scenario: Destructive confirmation uses error roles

- **WHEN** a confirm dialog renders its destructive action
- **THEN** the action uses the error/error-container roles and the dialog is focused (not a transient notification)

### Requirement: Snackbar feedback

The toast system SHALL evolve into Material snackbar behavior: bottom-placement, text + optional single action, auto-dismiss with pause-on-hover, screen-reader announcement, and the existing `useToast()` API SHALL remain source-compatible for the 100+ call sites. Errors requiring user intervention SHALL NOT be presented only as transient snackbars.

#### Scenario: Existing toast call sites unchanged

- **WHEN** existing code calls `useToast().success(...)` or `.error(...)`
- **THEN** it compiles and renders a snackbar without call-site modification

### Requirement: Progress, skeleton, tooltip

The design system SHALL provide linear and circular progress indicators, adopt the existing Skeleton compositions, and a tooltip primitive with keyboard-focus triggering and reduced-motion-aware appearance.

#### Scenario: Tooltip on focus

- **WHEN** an icon button with a tooltip receives keyboard focus
- **THEN** the tooltip appears and is announced via the button's accessible name remaining authoritative

### Requirement: Accessibility floor for primitives

Every design-system primitive SHALL: expose correct ARIA role/state/properties, support visible keyboard focus, meet 40px minimum touch target for pointer interaction (visual size may be smaller with padding hit-slop), maintain label associations, and remain operable under 200% font scaling without clipping or overlap.

#### Scenario: Touch targets

- **WHEN** a compact icon button (visual 32px) renders on a touch presentation
- **THEN** its interactive area is at least 40px in both dimensions

#### Scenario: Font scaling

- **WHEN** the root font size increases by 200%
- **THEN** primitives reflow using rem-based spacing without text clipping or horizontal overflow of their containers

### Requirement: Adoption enforcement

The repository SHALL document the design system and include a static check (lint rule or script) that flags new occurrences of the known ad-hoc patterns in migrated areas: the copy-pasted primary-button Tailwind recipe, raw hex colors in `className` strings, and arbitrary border-radius values — with an escape hatch for feature-specific cases (documented via suppression comment).

#### Scenario: Lint catches regression

- **WHEN** a migrated file reintroduces a hardcoded hex color inside a `className` string
- **THEN** the static check reports it with a message pointing at the token/primitive documentation
