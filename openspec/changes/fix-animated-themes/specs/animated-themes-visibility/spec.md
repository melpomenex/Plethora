## ADDED Requirements

### Requirement: Transparent Layout Elements on Premium Liquid Glass Themes

Premium liquid glass themes (Liquid Glass, Amber Liquid Glass, and Rosé Liquid Glass) SHALL override the backgrounds of layout containers (including `.app-shell`, `.bg-background`, `.main-content`, and `.bg-cream`) to be transparent or translucent, allowing the background blobs animated on `:root` via CSS to show through.

#### Scenario: Liquid glass theme shows animated background
- **WHEN** a user selects a premium liquid glass theme (e.g., "Liquid Glass", "Amber Liquid Glass", or "Rosé Liquid Glass")
- **THEN** layout elements like `.app-shell`, `.main-content`, and `.bg-cream` render transparently or translucently, and the animated backdrop is visible.
