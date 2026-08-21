---
id: platform.eink
title: True E-Ink Monochrome Mode
domain: platform
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - eink
summary: Dedicated pure monochrome high-contrast styling (data-display-mode="eink"), zero animations, paginated tap zones, and ghosting mitigation.
how_to: Open Settings → Appearance → Display Mode and select "E-ink Monochrome". Or toggle via Command Palette.
why: E-ink screens (Onyx Boox, Dasung, Bigme) have slow refresh rates and ghosting; true E-ink mode eliminates animations, maximizes contrast, and adds paginated tap zones.
aliases:
  - eink
  - e-ink
  - e-ink mode
  - eink mode
  - monochrome mode
  - high contrast
  - boox mode
  - e-paper
settings:
  - appearance.displayMode
  - appearance.einkContrastBoost
actions:
  - id: settings.appearance.eink
    label: Open E-ink Settings
    shortcut: Alt+,
related:
  - settings.themes
  - platform.mobile_android
  - reader.pdf.page_mode
---

# True E-Ink Monochrome Mode

## Purpose
Provides an optimized user interface specifically designed for slow-refresh, high-contrast electronic paper (E-ink) displays.

## User-Facing Behavior
- Strips all gradients, transparencies, blurred backdrops, and box shadows.
- Forces pure black text (`#000000`) on stark white backgrounds (`#FFFFFF`).
- Replaces continuous scrolling with discrete tap-zone pagination.
- Replaces loading spinners and animations with static progress indicators.

## Exact Behavioral Rules
1. Sets HTML root attribute `data-display-mode="eink"` which activates CSS overrides in `index.css`.
2. Disables all CSS transitions (`transition: none !important`) to eliminate sluggish E-ink ghosting trails.
3. Automatically increases font weight and line thickness on diagram borders and UI controls.

## Rationale
Standard modern web applications look washed out and suffer massive refresh lag on E-ink screens. Plethora treats E-ink as a first-class citizen.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `appearance.displayMode` | `"standard"` | Display rendering mode (`standard` or `eink`) |
| `appearance.einkContrastBoost` | `true` | Apply extra font sharpening and black-level clamp |

## Platform Behavior
- **Android E-ink Devices (Boox, Meebook)**: Fully integrates with native refresh APIs.
- **Desktop E-ink Monitors (Dasung, Paperlike)**: Crisp monochrome rendering with zero flicker.
