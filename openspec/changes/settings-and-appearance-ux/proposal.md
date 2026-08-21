# Change: Settings and Appearance UX Cleanup

Covers numbered requirements **#3 (theme picker space), #4 (toast on AI provider save), #9 (sidebar width), #15 (malformed Hands-Free toggle), #18 (Fast Cloud Transcription box ignores theme)**.

## Why

Five settings-surface issues, all grounded in the current Settings UI (`src/components/settings/`):

1. **Theme picker (#3):** `src/components/settings/ThemePicker.tsx:264` renders all **172 built-in themes** in a single flat grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`) of large `ThemeCard`s → ~43 rows on desktop. The `ThemeGallery` modal (`ThemeGallery.tsx`) already exists as a denser grouped browser. The library is valuable — it must be kept, but browsed more compactly.
2. **Provider-save toast (#4):** The AI provider save flow (`src/components/settings/LLMProviderSettings.tsx:230–248` → `src/stores/llmProvidersStore.ts`) performs no persistence confirmation. The app already has a `useToast()` system (`src/components/common/Toast.tsx:243`); other settings surfaces use it, but the AI provider save path does not.
3. **Sidebar width (#9):** The toolbar/sidebar (`src/components/Toolbar.tsx:863–913`) width is CSS-controlled via `--toolbar-rail-w` (3rem) / `--toolbar-expanded-w` (11.5rem) in `src/index.css:1317–1373`. It is hover-expandable but not user-resizable, and the Settings row for it is a **disabled** select (`SettingsPage.tsx:1544–1555`, "Not implemented — the sidebar has a fixed width").
4. **Hands-Free toggle (#15):** `src/components/settings/TTSSettings.tsx:1808–1829` uses a `role="switch"` button with a pill (`h-6 w-11`) + knob (`h-5 w-5 rounded-full`). Under some themes/viewports the sizing collapses and it renders as a "very large circle." There is no shared Switch component; the dominant pattern elsewhere is the `<label><input type="checkbox" class="sr-only peer">` + pill idiom.
5. **Fast Cloud Transcription box (#18):** `src/components/settings/AudioTranscriptionSettings.tsx:586–609` (and the duplicate in `src/components/transcription/TranscriptionKeyDialog.tsx:153–170`) hard-codes orange/amber/green/purple/blue Tailwind palette colors (`bg-gradient-to-br from-orange-500/10 to-amber-500/10`, `border-orange-200`, `text-orange-600`, etc.) that clash with dark/e-ink/high-contrast themes. Neighboring cards use theme tokens (`bg-card border border-border`, `bg-primary/10 text-primary`).

## What Changes

### 1. Theme picker (see `specs/theme-picker`)
Keep all 172 themes + custom themes. Replace the flat full-grid with a compact control that: shows the currently active theme clearly, provides useful previews, is searchable and filterable (light/dark/variant/animated), preserves instant preview (fix the currently stubbed `handlePreviewTheme` to live-apply on hover/keyboard focus, with the existing "Previewing" notice and "Click to apply"), works on narrow mobile and desktop, and remains keyboard/mouse/touch friendly. Do not render hundreds of heavyweight cards at once where virtualization is unnecessary — the compact picker (dropdown/popover + search + a small set of preview swatches) is preferred over a giant modal; reuse `ThemeGallery` only as a secondary "browse all" affordance if it adds value.

### 2. Provider-save toast (see `specs/provider-save-toast`)
Show a Plethora-native success toast after an AI provider is successfully saved/added (and failure toast on failure), using `useToast()`. Success must fire only after persistence succeeds (zustand persist write + native `set_api_key`/`set_ai_config` sync completes without error). Apply to all provider types sharing the save mechanism, not one hard-coded provider. Reuse existing subtle haptics only where already present (do not add vibration).

### 3. Sidebar width (see `specs/sidebar-width`)
Add a persisted sidebar-width setting (range + numeric, consistent with Font Size / Brightness controls) feeding the CSS vars `--toolbar-rail-w` and `--toolbar-expanded-w`, with sensible min/max/default matching current behavior, immediate live update, and mobile ignoring the setting (no desktop sidebar on mobile). Since the sidebar is not currently drag-resizable, the settings value is the single source of truth; do not introduce a second drag-resize system. Keep labels/icons usable and avoid horizontal overflow.

### 4. Hands-Free toggle (see `specs/hands-free-toggle`)
Fix the malformed Hands-Free toggle to use the standard Plethora switch idiom (correct proportions, clear on/off, aligned with label, theme-aware, adequate touch target, keyboard focusable, accessible `aria-checked`). Find the root CSS/component cause (e.g. theme `--spacing` leakage, global button rules, or the missing shared switch) rather than per-viewport pixel overrides.

### 5. Fast Cloud Transcription box (see `specs/fast-cloud-transcription-theming`)
Remove the hard-coded palette from the Fast Cloud Transcription card (both copies) and render it with Plethora theme tokens/components so it looks native across light, dark, custom, and high-contrast themes.

## Impact

### Affected Specs
- `theme-picker` (new, #3)
- `provider-save-toast` (new, #4)
- `sidebar-width` (new, #9)
- `hands-free-toggle` (new, #15)
- `fast-cloud-transcription-theming` (new, #18)

### Affected Code Areas
- `src/components/settings/ThemePicker.tsx`, `ThemeGallery.tsx` (#3)
- `src/components/settings/LLMProviderSettings.tsx`, `AIProviderSettings.tsx`, `src/stores/llmProvidersStore.ts` (#4)
- `src/components/Toolbar.tsx`, `src/index.css` (`.toolbar-rail` vars), `src/components/settings/SettingsPage.tsx` (Display section) (#9)
- `src/components/settings/TTSSettings.tsx:1808–1829`, plus any shared switch component extracted (#15)
- `src/components/settings/AudioTranscriptionSettings.tsx:586–609`, `src/components/transcription/TranscriptionKeyDialog.tsx:153–170` (#18)

### Non-goals
- No removal or re-theming of the theme library itself.
- No new save-button architecture for settings (auto-save remains).
- No drag-resize implementation for the sidebar.
- No invasive new haptics.