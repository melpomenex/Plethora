## MODIFIED Requirements

### Requirement: HTML document viewer applies theme colors to saved content
When displaying saved HTML content in the DocumentViewer iframe, the system SHALL apply the user's active theme colors (background, foreground, primary, muted, border, card) and compatible material to reading surfaces and cosmetic prose styling, overriding cosmetic styles from the original capture. Material-aware presentation SHALL preserve semantic structure, meaningful colors in figures/diagrams/legends/equations, and original media pixels. Theme changes SHALL NOT modify stored source content.

#### Scenario: Viewing a saved page in dark theme
- **WHEN** a user views a saved HTML document while using a dark theme
- **THEN** the document background matches the theme's `--color-background`
- **AND** the text color matches the theme's `--color-foreground`
- **AND** links use the theme's `--color-primary`

#### Scenario: Viewing a saved page in light theme
- **WHEN** a user views a saved HTML document while using a light theme
- **THEN** the document background matches the theme's `--color-background`
- **AND** the text color matches the theme's `--color-foreground`
- **AND** code blocks use the theme's `--color-muted` for backgrounds

#### Scenario: Switching themes while viewing a document
- **WHEN** a user changes the active theme while an HTML document is displayed
- **THEN** the document viewer re-applies the new theme colors and compatible material immediately without replacing anchored content

#### Scenario: Paper around meaningful media
- **WHEN** a saved page contains a colored chart, equation, table and source image under Legal Pad
- **THEN** reading surfaces use paper while content structure, image pixels, meaningful visual distinctions and readable code/table insets are preserved

### Requirement: Rich content renderer applies theme colors
The RichContentRenderer component SHALL apply the user's active theme colors and compatible material when rendering extract HTML content in its sandboxed iframe, instead of using hardcoded light-theme colors. Live theme/preview/accessibility changes SHALL update appearance without iframe navigation or source-content changes. Small previews SHALL remain unruled and meaningful media colors SHALL be preserved.

#### Scenario: Viewing an extract in dark theme
- **WHEN** a user views an extract with HTML content while using a dark theme
- **THEN** the extract's iframe background matches the theme's `--color-background`
- **AND** the text color matches the theme's `--color-foreground`
- **AND** links use the theme's `--color-primary`
- **AND** code block backgrounds use the theme's `--color-muted`

#### Scenario: Viewing an extract in light theme
- **WHEN** a user views an extract with HTML content while using a light theme
- **THEN** the extract's iframe background matches the theme's `--color-background`
- **AND** all reading colors match the active light theme

#### Scenario: Expanded extract follows paper preview
- **WHEN** Legal Pad is previewed and canceled while an extract is expanded
- **THEN** the expanded reading material updates and reverts in place with valid selection and preserved source media
