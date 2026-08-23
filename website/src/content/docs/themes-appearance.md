---
title: "100+ Themes & Custom Fonts"
description: "Comprehensive visual theming system featuring 26 modern themes, 121 legacy palettes, 65 bundled font packages, and custom color accents."
category: "settings-privacy-troubleshooting"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios","eink","pwa","all"]
keywords: ["themes","dark mode","fonts","color schemes","appearance"]
aliases: ["themes","dark mode","fonts","color schemes","appearance"]
relatedDocs: ["platform.eink","reader.markdown.native","review.zen_mode"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/settings/themes-appearance.md"
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