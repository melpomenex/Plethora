## 1. Core renderer

- [x] 1.1 Create `src/themes/jellyfishPalettes.ts` with four palette configs and scenic CSS factory
- [x] 1.2 Create `src/components/common/ambient/jellyfishRenderer.ts` with draw + animation loop
- [x] 1.3 Register `jellyfish` in `ThemeBackdrop.tsx` and extend `AnimCtx` with `themeId`, `paletteId`, `staticOnly`
- [x] 1.4 Fix ThemeBackdrop effect deps and static-only mount path
- [x] 1.5 Enlarge and center the scenic jellyfish, add anatomical bell/arm detail, and make swimming motion perceptible

## 2. Theme definitions

- [x] 2.1 Add four theme objects to `builtin.ts` and `builtInThemes` array
- [x] 2.2 Add `BUILTIN_THEMES` constants in `types/theme.ts`
- [x] 2.3 Extend `ThemeEffects` with `ambientPaletteId`

## 3. Settings UX

- [x] 3.1 Add Animated section to `ThemeGallery.tsx` (optional discovery)
- [x] 3.2 Verify Animated filter surfaces jellyfish themes (search "jellyfish")

## 4. Tests

- [x] 4.1 `jellyfishPalettes.test.ts` — palette keys and theme registration
- [x] 4.2 `jellyfishRenderer.test.ts` — static draw, deterministic freeze
- [x] 4.3 Update ThemePicker test count if needed
- [x] 4.4 Verify modeAccent and readerThemeTokens pass for new themes
- [x] 4.5 Add regression coverage for centered layout, hero scale, draw complexity, and visible motion

## 5. Documentation

- [x] 5.1 Add brief note to themes-appearance docs or renderer file header

## 6. Packaged runtime regression

- [x] 6.1 Make Jellyfish backdrop mounting and critical shell transparency independent of lazy chunk loading and runtime-injected CSS, with regression coverage
- [x] 6.2 Ensure repository-provided local macOS package commands ad-hoc sign the complete app bundle, with script regression coverage
