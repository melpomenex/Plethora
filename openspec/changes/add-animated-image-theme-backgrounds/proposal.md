## Why

People can already select a GIF in **Create Theme from Image**, but Plethora draws it once to a canvas and saves a still. An animation whose colors change over time can also produce a theme that reflects only its opening image. GIF import should provide a representative palette and an optional moving backdrop while keeping the app comfortable for long reading sessions.

## What Changes

- Extend the existing picker and responsive image-theme creator to recognize multi-frame GIFs by content, prepare them locally, and preview the result behind the actual app. Keep the name, mood, variant, accent, blur, brightness, scrim, and surface controls. Show progress, a useful error or still-image outcome, and a single per-theme **Play animation** preference.
- Derive a stable palette from duration-weighted composited frames through the existing OKLCH engine. Guard text, controls, and focus indicators against the effective background, with protected reading and overlay surfaces.
- Play a bounded rendition through one dedicated media backdrop under the existing shell. Use the saved poster when animation is disabled, power or motion policy calls for a still, or playback fails. Suspend work in the background. Preserve the desktop-on and native-mobile-off defaults of the existing global setting.
- Stage previews in memory and commit the theme and local binary assets when the user saves. Support restart, re-selection, preference changes, replacement, and deletion. Label JSON exports that omit local artwork. Saved still-image themes and built-in animations continue to use their existing paths.
- Ship GIF import, automatic quality, controllable playback, and poster fallback first. Defer native video conversion, animated WebP/APNG import, portable media packages, additional playback controls, and per-frame theme changes.

## Capabilities

### New Capabilities

- `animated-image-themes` covers GIF import, analysis, theme creation and sharing, playback policy, accessibility, persistence, and resource budgets.

### Modified Capabilities

- `gpu-theme-rendering` scopes the existing renderer-selection requirement to procedural effects registered through `effects.backgroundAnimation`.

## Impact

- **Application** · Image theme preparation and OKLCH synthesis, ThemeProvider and IndexedDB, Appearance settings and search, Theme Picker, the single shell backdrop, and image-theme surface styles. Existing GIF-independent settings retain their meanings.
- **Dependencies** · One lazy worker decoder adapter is expected. Decoder selection depends on a bounded decoding spike and dependency review. The first release avoids codecs or binaries that must be installed by the user, native transcoder packaging, and remote processing.
- **Risks and compatibility** · GIF disposal, timing, and transparency vary in real files. Worker and still-frame decoding support, blur cost, and lifecycle signals vary across shipped WebViews. Bounded preparation, a saved poster, per-target acceptance, and legacy storage readers limit the impact of failure or rollback.
- **Success criteria** · The acceptance GIFs preview and reselect with their palette and animation after restart on qualified targets. Pause conditions leave zero backdrop decode scheduling, protected content passes contrast checks, and packaged WebViews meet the documented resource budgets or use the defined still fallback. Older still-image themes remain usable.
