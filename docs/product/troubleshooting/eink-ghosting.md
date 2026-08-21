---
id: troubleshooting.eink_ghosting
title: Troubleshooting: E-Ink Screen Ghosting & Sluggish Refresh
domain: troubleshooting
status: implemented
platforms:
  - eink
  - mobile-android
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Optimization guide for eliminating shadow artifacts, blurry residual text, and refresh lag on electronic paper displays.
how_to: Toggle E-ink Monochrome mode in Settings → Appearance, enable contrast boost, and switch scrolling to page tap mode.
why: Physical electronic paper microcapsules retain residual magnetic polarity when animating fast; dedicated E-ink mode clears ghosting artifacts.
aliases:
  - eink ghosting
  - boox refresh lag
  - screen artifacts
  - eink clear screen
settings:
  - appearance.displayMode
  - appearance.einkContrastBoost
actions:
  - id: settings.appearance.eink
    label: Open E-ink Settings
    shortcut: Alt+,
related:
  - platform.eink
  - settings.themes
  - reader.pdf.page_mode
---

# Troubleshooting: E-Ink Screen Ghosting & Sluggish Refresh

## Purpose
Provides comprehensive configuration recipes to achieve crystal-clear, ghost-free reading on Onyx Boox, Dasung, Bigme, and other E-ink devices.

## User-Facing Behavior
- **Symptom**: Faint shadows of previously read text or interface buttons remain visible behind current text.
- **Cause 1**: Standard display mode is active with smooth scrolling animations and gray shadows.
- **Cause 2**: E-ink device refresh mode is set to "Speed/A2" instead of "Regal/Normal" reading mode.

## Exact Behavioral Rules
1. In Plethora: Set Settings → Appearance → Display Mode to **E-ink Monochrome**.
2. In Plethora: Enable **E-ink Contrast Boost** to sharpen text edges to pure black (`#000000`).
3. In Reader: Switch PDF / Article viewer from continuous scroll to **Page Mode** with tap zones.
4. On your device: Set Plethora app optimization to "Regal Mode" or trigger full screen refresh every 10 page turns.

## Rationale
Eliminating CSS transitions and gray anti-aliased font halos prevents the physical e-paper capsules from half-turning, resulting in pristine contrast.

## Platform Behavior
- Specific to electronic paper displays and devices running Android or desktop E-ink monitors.
