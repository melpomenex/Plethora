## ADDED Requirements

### Requirement: Semantic Token System & Editorial Midnight Library Theme
The website styling architecture SHALL define semantic CSS custom properties in `website/src/styles/tokens.css` that support both light paper-and-ink and dark "midnight library" themes (deep charcoal/eggplant surfaces `#121016`/`#1a1622`/`#251f30`, warm ivory text `#f4efe6`/`#d8d0c2`, desaturated violet-gray borders `#2e273a`, and restrained Plethora violet accents `#8b5cf6`/`#7c3aed`), eliminating all hard-coded `#fff` or light-only values across all public routes.

#### Scenario: Light theme token resolution
- **WHEN** the effective theme is light
- **THEN** `--paper` resolves to `#f3f0e8`, `--ink` resolves to `#1c1916`, and card surfaces resolve to `--surface-card`.

#### Scenario: Dark theme token resolution
- **WHEN** the effective theme is dark
- **THEN** `--paper` resolves to `#121016`, `--ink` resolves to `#f4efe6`, and card surfaces resolve to `#1c1826`.

### Requirement: Zero-FOUC Early Theme Bootstrap
The website layout SHALL execute a synchronous inline bootstrap script in the document `<head>` prior to stylesheet parsing and first contentful paint, reading the user's stored preference from `localStorage` or falling back to the OS `prefers-color-scheme`, setting `data-theme`, `data-effective-theme`, and `color-scheme` on `document.documentElement` to eliminate any visible flash of incorrect theme.

#### Scenario: Initial page load with dark OS preference
- **WHEN** a user visits any website route for the first time with an OS dark mode preference and no saved choice in `localStorage`
- **THEN** the inline `<head>` script sets `data-theme="system"`, `data-effective-theme="dark"`, and `color-scheme: dark` before the first HTML element renders, preventing any white flash.

#### Scenario: Explicit theme preference persistence
- **WHEN** a user with a light OS preference previously selected "Dark" mode and reloads the page
- **THEN** the inline `<head>` script reads `localStorage.getItem('plethora-theme')` as `'dark'` and renders the dark palette immediately on initial paint.

### Requirement: Accessible Header Theme Control
The website header (`SiteHeader.astro`) and mobile navigation drawer SHALL provide an accessible 3-state theme selector (`System`, `Light`, `Dark`) with keyboard operability (Tab, Enter, Space, Arrow keys, Escape to close) and dynamic updating of browser `<meta name="theme-color">`.

#### Scenario: User toggles theme via header control
- **WHEN** user selects "Dark" from the header theme control
- **THEN** `localStorage` is updated with `plethora-theme = 'dark'`, `<html>` data attributes and `color-scheme` update immediately, `<meta name="theme-color">` updates to `#121016`, and a custom `plethora-theme-change` DOM event is dispatched without reloading the page.

#### Scenario: Operating system preference change in System mode
- **WHEN** user preference is set to `System` and the OS theme switches from light to dark
- **THEN** the `matchMedia` change listener updates the effective theme to dark and adjusts page surfaces and theme-color metadata dynamically.

### Requirement: Universal Route Coverage & WCAG AA Contrast Compliance
Every public website route, component, dialog, navigation drawer, and search modal SHALL render with full visual fidelity in both light and dark themes, meeting WCAG 2.1 AA contrast requirements (minimum 4.5:1 for standard text, 3:1 for large text and interactive UI controls).

#### Scenario: Automated contrast verification
- **WHEN** automated accessibility tests run across all public routes in dark mode
- **THEN** all body text, headings, links, button states, focus indicators, and form inputs pass WCAG AA contrast ratio thresholds.
