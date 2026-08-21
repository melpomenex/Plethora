# Implementation Tasks

## 1. Theme picker (#3)
- [x] 1.1 Design and implement a compact theme control (searchable combobox/popover or compact swatch list) in `ThemePicker.tsx`; keep all themes reachable
- [x] 1.2 Surface the active theme name + swatch; add light/dark/variant/animated filters
- [x] 1.3 Make `handlePreviewTheme` live-apply on hover/keyboard focus with "Previewing" notice + explicit commit
- [x] 1.4 Keep theme cards lightweight (swatches) for performance; reuse `ThemeGallery` only as a secondary "browse all" if useful
- [x] 1.5 Verify narrow-mobile usability, touch targets, keyboard access

## 2. Provider-save toast (#4)
- [x] 2.1 In `LLMProviderSettings.tsx`/`AIProviderSettings.tsx` add `useToast()` success on add/update after persistence completes
- [x] 2.2 Add failure/error toast on persistence failure (native key-store/`set_api_key`/`set_ai_config` reject)
- [x] 2.3 Ensure toast fires for all provider types via the shared save path; no new haptics

## 3. Sidebar width (#9)
- [x] 3.1 Add `interface.sidebarWidth` (or similar) to `settingsStore` defaults + validation
- [x] 3.2 Wire the setting to `--toolbar-rail-w` / `--toolbar-expanded-w` (or inline style on `.toolbar-rail`)
- [x] 3.3 Add range + numeric control in Appearance → Display, replacing the disabled row (`SettingsPage.tsx:1544–1555`)
- [x] 3.4 Ensure mobile ignores the setting; verify no horizontal overflow at extremes

## 4. Hands-Free toggle (#15)
- [x] 4.1 Identify the root cause of the oversized-circle render (verify `--spacing` leakage / theme `customCSS` / missing shared switch)
- [x] 4.2 Fix using the standard switch idiom; correct proportions, alignment, focus ring, `aria-checked`, touch target
- [x] 4.3 Extract a shared switch component only if it is clearly beneficial; reuse existing idiom otherwise

## 5. Fast Cloud Transcription theming (#18)
- [x] 5.1 Re-theme `AudioTranscriptionSettings.tsx:586–609` and `TranscriptionKeyDialog.tsx:153–170` with theme tokens
- [x] 5.2 Remove hard-coded palette colors at the source; verify light/dark/high-contrast

## 6. Tests
- [x] 6.1 Theme picker: many themes, search/browse/select, active retained, mobile + desktop dimensions
- [x] 6.2 Provider save: success → toast, failure → error feedback (test store/mock native sync)
- [x] 6.3 Sidebar: min, max, persisted width, narrow window, mobile ignored
- [x] 6.4 Hands-Free: desktop, narrow/mobile, theme variations, keyboard/touch operation, `aria-checked`
- [x] 6.5 Fast Cloud Transcription: representative light/dark/custom/high-contrast themes
- [x] 6.6 Run `npm run test:run` affected suites; run `npm run lint` on changed files

## 7. Spec
- [x] 7.1 Confirm spec files match implementation
