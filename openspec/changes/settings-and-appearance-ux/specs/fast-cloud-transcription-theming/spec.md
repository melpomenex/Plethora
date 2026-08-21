## MODIFIED Requirements

### Requirement: Fast Cloud Transcription box consumes theme tokens
The "Fast Cloud Transcription" card in Speech To Text settings (`src/components/settings/AudioTranscriptionSettings.tsx:586–609`) and its duplicate in `src/components/transcription/TranscriptionKeyDialog.tsx:153–170` SHALL be re-themed to use Plethora theme tokens/components like neighboring Settings UI. Hard-coded palette colors (the orange/amber gradient, `border-orange-200`, `text-orange-600`, and the green/purple/blue badge colors) SHALL be replaced with theme-derived colors so the card looks intentional in every theme.

#### Scenario: Dark theme
- **WHEN** the Fast Cloud Transcription card is rendered under a dark theme
- **THEN** the card background, text, border, and badges SHALL be legible and consistent with the dark theme (no harsh fixed light-palette colors)

#### Scenario: Light theme
- **WHEN** the Fast Cloud Transcription card is rendered under a light theme
- **THEN** the card SHALL match neighboring cards (e.g. `bg-card border border-border`, `bg-primary/10 text-primary` accents) and SHALL look like an intentional part of the light theme

#### Scenario: High-contrast theme
- **WHEN** the card is rendered under a high-contrast theme
- **THEN** text/background contrast SHALL remain sufficient for the theme's contrast requirements

### Requirement: All element states are themed
Background, foreground/text, border, accent, hover, focus, disabled states, icons, embedded buttons, and badges/warnings in the Fast Cloud Transcription card SHALL consume theme tokens or theme-aware semantic colors.

#### Scenario: Embedded buttons and badges
- **WHEN** the card contains an embedded button or badge
- **THEN** its colors SHALL come from the theme (e.g. `bg-primary text-primary-foreground`, theme warning tokens) and SHALL remain readable across theme variants

### Requirement: Hard-coded styling is eliminated at the source
Where possible the underlying hard-coded styling SHALL be removed so future themes inherit correct colors automatically, rather than adding a one-off token override per theme.

#### Scenario: New theme inherits
- **WHEN** a new theme is selected
- **THEN** the card SHALL render with that theme's tokens automatically with no per-theme special-casing added for this component