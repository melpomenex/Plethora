## MODIFIED Requirements

### Requirement: Renderer abstraction with backend selection

The system SHALL render procedural theme background effects identified by `effects.backgroundAnimation` through a framework-independent renderer layer (`ambient/renderer/`) that selects between a WebGL2 backend, a Canvas2D backend, and a static single-frame path, selected per effect via `EFFECT_REGISTRY` entries that MAY declare `webgl` implementations, `canvas2d` implementations, `supportsStatic`, and a renderer preference. Imported animated image media SHALL use its own playback path as specified by `animated-image-themes`.

#### Scenario: GPU-preferred effect uses WebGL2 when available
- **WHEN** a theme whose `effects.backgroundAnimation` has a `webgl` implementation is active on a WebView where `canvas.getContext("webgl2")` succeeds, animations are enabled, and motion is not reduced
- **THEN** the backdrop renders through the WebGL2 backend and diagnostics report `backend=webgl2`

#### Scenario: Canvas-preferred effect stays on Canvas2D
- **WHEN** a particle-shaped effect without a `webgl` implementation (e.g., `rain`) is active
- **THEN** the backdrop renders through the Canvas2D backend at 30 fps with today's visuals

#### Scenario: Unknown effect id leaves rendering to CSS
- **WHEN** a theme references an animation id that resolves through neither exact nor prefix registry match (e.g., `liquid-glow`)
- **THEN** no renderer is created and the theme's CSS-driven visuals continue to work

#### Scenario: Imported image bypasses the effect registry
- **WHEN** the active backdrop is an imported animated image
- **THEN** the image is handled by the media playback path and no procedural renderer is created for it
