# Website fonts and licenses

Marketing type is loaded only from `website/package.json`. Root app font packages are not imported.

| Face | Package | Role | License |
|---|---|---|---|
| System UI stack | (none) | UI, nav, body, CTAs — `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"` | Platform fonts |
| Source Serif 4 (latin 400, 400 italic, 600, 700) | `@fontsource/source-serif-4` | Display headlines | SIL Open Font License 1.1 (`node_modules/@fontsource/source-serif-4/LICENSE`) |

OFL 1.1 allows use, study, modification, and redistribution of the font software provided the fonts are not sold by themselves. Reserved font names remain with the authors.

## Loading

- CSS `@import` of Fontsource **latin** files only for the display serif.
- `font-display: swap` (Fontsource default) so headline text is visible during load (no FOIT).
- Metric-matched fallback (`Source Serif Fallback`) with `size-adjust` / `ascent-override` in `website/src/styles/fonts.css`.
