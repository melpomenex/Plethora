---
id: settings.themes
title: 100+ Themes & Custom Fonts
domain: settings
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
  - eink
  - pwa
  - all
summary: Comprehensive visual theming system featuring 26 modern themes, 121 legacy palettes, 65 bundled font packages, and custom color accents.
how_to: Open Settings → Appearance → Themes. Browse light, dark, and OLED themes or choose bundled typography (Inter, JetBrains Mono, Merriweather, etc.).
why: Reading comfort depends heavily on personal visual sensitivity; tailored ambient color temperatures and optical typography prevent eye fatigue.
aliases:
  - themes
  - dark mode
  - fonts
  - color schemes
  - appearance
settings:
  - appearance.themeId
  - appearance.fontFamily
  - appearance.customAccentColor
actions:
  - id: settings.appearance.themes
    label: Open Theme Settings
    shortcut: Alt+,
related:
  - platform.eink
  - reader.markdown.native
  - review.zen_mode
---

# 100+ Themes & Custom Fonts

## Purpose
Provides a deeply customizable typography and color design system engineered specifically for long reading and study sessions.

## User-Facing Behavior
- Live theme gallery with categories: Modern Dark, Warm Sepia, Solarized, Nord, Dracula, High-Contrast OLED, E-ink Monochrome, and Retro Palettes.
- 65 high-quality bundled font packages (Sans-serif, Serif, Monospace, Dyslexic-friendly).
- Real-time instant preview without requiring page reloads.

## Exact Behavioral Rules
1. Themes update CSS custom properties dynamically on the document root (`--background`, `--foreground`, `--primary`, `--border`).
2. Bundled font assets are loaded locally via `@fontsource` packages with zero external Google Fonts network calls.
3. Automatically respects system dark/light mode schedule if configured.

## Rationale
Personalized visual aesthetics increase enjoyment and eliminate the friction of staring at harsh default screens for hours.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `appearance.themeId` | `"zinc-dark"` | Default application color theme |
| `appearance.fontFamily` | `"Inter"` | Base reading UI font family |

## Platform Behavior
- **All Platforms**: Full theme switching support with zero layout shift.
