## Context

See `proposal.md` for motivation and `specs/document-rating/spec.md` for the behavior contract.

- `ScrollOverlayControls.tsx:584` anchors the bottom dock using `bottom-28`. Its horizontal rail includes ratings plus drag and placement utilities, with no viewport width constraint.
- `MobileAssistantHost.tsx:180` portals the Assistant layer to the document body. `viewport.ts:12` anchors its bubble above measured navigation or the shell safe bottom. `mobile-assistant.css:4` gives it a minimum height of 48px. These values do not inform the rating dock.
- The dock uses hard-coded slate glass, fixed red/orange/blue/green gradients, and white icons. `DocumentViewer.tsx:8496` independently renders similarly hard-coded inline orbs; it does not use the relocatable dock. Scroll Mode hides those inline orbs via its viewer props.
- Existing theme roles include surface containers, paired foregrounds, primary, error, warning, success, and outlines (`src/types/theme.ts`). The `theme-aware-mode-accent` change explicitly excludes overlay chrome. Mobile Assistant work remains in unarchived changes, so geometry integration must be additive.

## Goals / Non-Goals

**Goals:** Establish one-way geometry ownership between shell controls and the rating dock; use shared styling for rating identity; retain the reading surface's density and the existing round orb shape.

**Non-Goals:** Redesign the Assistant sheet, navigation, top reader toolbar, flashcard grading controls, or theme editor. No scheduling, haptic, edge-setting schema, or queue-origin gating changes. No generic collision engine for every overlay.

## Decisions

### 1. Keep the Assistant anchored; lift the rating dock

The mobile shell publishes the highest occupied boundary of its currently visible bottom controls. Add a small shell-owned geometry context/bridge, populated from the existing navigation reference and the Assistant bubble reference. Publish a viewport-coordinate `occupiedTop` only for visible controls. The portaled overlay can consume this through React context; desktop and isolated renders receive an empty/default value.

The dock derives its bottom coordinate from that boundary with an 8px gap. With no visible bottom controls, use the visible viewport bottom minus the shell safe inset and a 12px edge gap. Convert viewport coordinates to the dock's fixed containing-block coordinates explicitly using the existing app viewport offset/height metrics; do not mix visual-viewport-local and layout-viewport coordinates. The shell remains the only owner of keyboard/browser viewport observations.

Update on the existing viewport notifications, relevant visibility/state transitions, and `ResizeObserver` size changes. Read geometry in a layout effect before revealing an interactive bottom dock. Clear registrations on hide/unmount and disconnect observers on cleanup. The dock never moves the Assistant, preventing measurement feedback loops. Observe the measured bubble itself so localization and enlarged text are accounted for.

Drag remains a direct manipulation preview. On release, both drag snapping and the directional menu use the same settled geometry. Automatic clearance does not emit user docking haptics or persist a new setting. Retain existing overlay priority and inert behavior while the Assistant sheet is open; verify keyboard focus as well as pointer blocking.

Alternatives: increasing `bottom-28` still fails with different safe areas and text sizes; changing z-index merely changes which control is obscured; moving the Assistant breaks its familiar anchor; permanent empty clearance wastes reading space when the bubble is hidden.

### 2. Keep rating actions primary at narrow widths

Constrain horizontal docks to viewport width minus safe left/right insets and 8px outer margins. Retain a single horizontal ratings row, with at least 44px targets and 8px gaps. Reduce decorative padding before changing control structure. When the measured content cannot fit, move drag/placement utilities together into a secondary row; preserve DOM and focus order to match the visual order. Apply the same width discipline to top docking without changing its anchor behavior.

Limit dock height to the usable region below upper reader controls and above the occupied bottom region. For short landscape/enlarged-text layouts, allow internal vertical scrolling with focus scrolling into view. Keep placement menus within that usable region, using a portal if the scroll container would clip them. Do not silently change the user's selected edge.

Alternatives: shrinking icons and hit targets weakens touch usability; clipping or hiding grades changes the review workflow; retaining a huge single row creates off-screen actions.

### 3. Make the orbs part of the theme

Extract a shared rating style contract (classes/local CSS variables), consumed by the Scroll Mode dock and inline reader orbs without combining their different rating logic. Use a tonal surface-container dock, outline-role borders, and on-surface foregrounds. Menus/tooltips use existing paired surface or inverse-surface roles. Replace literal glow colors and dark glass with theme-derived tonal emphasis and existing state-layer behavior.

Use these semantic accents as subtle tints/indicators within themed tonal orb surfaces:

| Action | Accent source | Identity cue |
| --- | --- | --- |
| Again | error | WarningCircle |
| Hard | warning | Star |
| Good / mark as read | primary | CheckCircle |
| Easy | success | Sparkle |
| Dismiss | on-surface-variant / outline | EyeSlash |

Use an opaque theme surface as the base for any mixed accent tint, with a verified foreground/background pair. Existing color/contrast utilities may resolve additional pairs centrally if necessary; do not scatter black/white assumptions, runtime color parsing, or new required fields across components. If an accent cannot meet contrast, retain it as a decorative tint and use a readable theme foreground for the icon/text. No mandatory theme JSON changes. Theme changes flow through existing CSS variables; monochrome/e-ink overrides remain effective.

The orb silhouettes, icons, order, labels, grade values, and disabled behavior remain intact. Add explicit accessible button names and focus-visible labels/tooltips where the existing hover-only labels leave keyboard users without equivalent information. Use consistent treatment for Good and mark-as-read, which currently use different fixed colors.

Alternatives: recoloring only the dock leaves the dominant rainbow controls outside the theme; making every grade an identical unlabeled accent weakens recognition; introducing a new palette preference adds settings burden without solving the requested integration.

## Risks / Trade-offs

- [Additional stacked height obscures more reading content] → Use exactly the visible occupied region, a small gap, compact spacing, and bounded height rather than a permanent large spacer.
- [Stale geometry after hidden navigation or bubble state changes] → Publish from owners on visibility transitions and resize; test cleanup, remount, viewport offsets, and rapid show/hide sequences.
- [Custom theme accent contrast varies] → Resolve against opaque theme surfaces and verify actual foreground/background pairs; preserve non-color grade cues and monochrome overrides.
- [Shared styling accidentally changes rating semantics] → Keep handler ownership in each component and rerun queue gating, grading, disabled, and haptic tests.
- [Concurrent Assistant work] → Limit changes there to geometry publication; reconcile against the current host before implementation and leave its composer and gesture design intact.

## Migration Plan

Ship as a frontend-only layout/style update. Existing `ratingOrbsPosition` values continue to work without migration. Validate component behavior, actual rendered geometry, and representative theme states before release. Rollback removes the geometry bridge and shared presentation changes without touching user settings or scheduling data.
