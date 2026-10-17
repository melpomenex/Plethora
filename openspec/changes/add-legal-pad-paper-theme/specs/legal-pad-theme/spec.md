## Purpose

Define Legal Pad — Archival Yellow as a complete, accessible built-in Plethora theme with coherent application surfaces, real previews, responsive presentation and durable user controls.

## ADDED Requirements

### Requirement: Built-in Legal Pad selection
The theme catalog SHALL offer **Legal Pad — Archival Yellow** with ID `legal-pad`, light variant, and static classification in the existing searchable picker and gallery. Selection SHALL immediately apply coherent warm semantic colors and the paper material, with readable fallback while assets load. The theme SHALL be available after offline restart without requiring the full catalog before correct initial colors.

#### Scenario: Find and activate
- **WHEN** the user searches for Legal Pad and selects it
- **THEN** the application acquires the paper palette and material, the picker reflects the selection, and the theme is not described as animated or HDR

#### Scenario: Saved theme startup
- **WHEN** the app restores a previously committed legal-pad theme
- **THEN** its first application-owned appearance after preference restoration uses the paper palette without an intervening wrong reader background

### Requirement: Application-wide surface coverage
Legal Pad SHALL style dashboard, library grids/lists/cards, navigation/sidebar/toolbars/tabs, mobile navigation, settings/search/command palette, dialogs/sheets/context menus, empty/loading/error states, assistant conversation/composer, queue/flashcards/extracts, annotation controls and knowledge-panel chrome. Utility surfaces SHALL remain organized with opaque tonal paper fills and clear interactive states; source media and visualization pixels SHALL retain fidelity.

#### Scenario: Navigate and open a sheet
- **WHEN** the user moves from the library to settings and opens a dialog or mobile sheet
- **THEN** all application-owned backgrounds, navigation edges and panel fills remain coherent paper surfaces without opaque unrelated white/gray panels or unreadable transparency

#### Scenario: Study and interact
- **WHEN** the user reviews a flashcard, annotates an extract, uses assistant input or opens a knowledge inspector
- **THEN** paper styling remains consistent while rating controls, selection actions, focus and status distinctions stay clearly identifiable

### Requirement: Decoration and typography separation
Reading ruling SHALL be subtle decoration rather than a forced text baseline grid. The red margin SHALL remain outside reading content or be hidden when space is insufficient. Legal Pad SHALL preserve user fonts, sizes, line heights, paragraph spacing, reading measures, zoom and reflow; it SHALL NOT introduce handwritten/cartoon typography or modify reader direction.

#### Scenario: Typography change
- **WHEN** a user changes font size or line height in a compatible reader
- **THEN** text reflows according to the user's setting and the ruling does not reposition text to match notebook lines

#### Scenario: Narrow or landscape pane
- **WHEN** a pane is too narrow for the red margin, uses unsupported writing layout, or has restrictive safe-area insets
- **THEN** the margin is hidden instead of crossing text, list markers or native selection affordances

### Requirement: Focused persistent paper controls
Appearance settings SHALL expose Paper Detail with Subtle/Authentic/Maximum, Notebook Ruling on/off and Red Margin on/off for the paper theme, defaulting to Authentic/on/on. These choices SHALL persist using existing settings mechanisms, normalize missing or invalid data safely, and restore on reselect. Ruling off SHALL hide the margin while preserving the user's stored margin choice. Temperature and separate ruling-intensity controls SHALL NOT be required for this release.

#### Scenario: Customize and restart
- **WHEN** the user selects Subtle detail, turns ruling off, commits settings and restarts
- **THEN** those choices restore and neither ruling nor the red margin is visible

#### Scenario: Restore ruling and reset
- **WHEN** the user re-enables ruling or resets paper preferences
- **THEN** re-enabling restores the stored margin choice and reset restores Authentic/on/on defaults

### Requirement: Real preview with reversible application
Picker/gallery previews SHALL show actual paper character and ruling, SHALL update open compatible readers with the same applied appearance as chrome, and SHALL preserve the committed theme/preferences until explicit commit. Cancellation, closing, pointer exit or unmount SHALL revert preview effects without changing source content, reading location or persisted settings.

#### Scenario: Preview then cancel
- **WHEN** the user previews Legal Pad while a different theme is committed and dismisses the picker
- **THEN** host and compatible readers return to the committed appearance and no paper attributes, textures or styles remain active

#### Scenario: Commit and switch away
- **WHEN** the user explicitly commits Legal Pad and later chooses another theme
- **THEN** the selection persists correctly and material resources/effects are removed from the other theme while saved paper controls remain available for reselection

### Requirement: Mobile continuity and interaction
The theme SHALL fill application-owned safe-area edges, navigation containers and overlays consistently in portrait/landscape, fullscreen and keyboard-open states. Texture SHALL not stretch or flicker during viewport changes. It SHALL NOT interfere with touch gestures, native selection handles or established navigation/dialog geometry.

#### Scenario: Reader keyboard sheet
- **WHEN** a phone reader opens an assistant composer or annotation sheet and the keyboard appears
- **THEN** safe-area edges remain filled, text/input remains readable and reachable, and no texture layer intercepts gestures or covers controls

### Requirement: Effective textured contrast
The complete rendered material SHALL meet WCAG AA contrast for normal/secondary text and meaningful controls against the lightest/darkest meaningful composed regions, including texture, ruling, highlights and interaction states. Normal text SHALL meet 4.5:1, large text and meaningful focus/control boundaries SHALL meet 3:1. Links and critical interaction states SHALL have non-color cues. Validation SHALL use actual approved assets rather than nominal palette swatches alone.

#### Scenario: Worst composed patch
- **WHEN** approved paper textures are composited under text, focus, highlight, code or table content
- **THEN** measured effective contrast passes the applicable threshold across meaningful extrema and selected states

#### Scenario: Highlight on yellow paper
- **WHEN** a stored highlight, active search match or spoken-word highlight appears
- **THEN** text remains readable and the states remain distinguishable without changing stored annotation identities
