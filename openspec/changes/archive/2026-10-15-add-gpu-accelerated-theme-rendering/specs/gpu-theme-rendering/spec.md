## ADDED Requirements

### Requirement: Renderer abstraction with backend selection

The system SHALL render animated theme backgrounds through a framework-independent renderer layer (`ambient/renderer/`) that selects between a WebGL2 backend, a Canvas2D backend, and a static single-frame path, selected per effect via `EFFECT_REGISTRY` entries that MAY declare `webgl` implementations, `canvas2d` implementations, `supportsStatic`, and a renderer preference.

#### Scenario: GPU-preferred effect uses WebGL2 when available
- **WHEN** a theme whose `effects.backgroundAnimation` has a `webgl` implementation is active on a WebView where `canvas.getContext("webgl2")` succeeds, animations are enabled, and motion is not reduced
- **THEN** the backdrop renders through the WebGL2 backend and diagnostics report `backend=webgl2`

#### Scenario: Canvas-preferred effect stays on Canvas2D
- **WHEN** a particle-shaped effect without a `webgl` implementation (e.g. `rain`) is active
- **THEN** the backdrop renders through the Canvas2D backend at 30 fps with today's visuals

#### Scenario: Unknown effect id leaves rendering to CSS
- **WHEN** a theme references an animation id that resolves through neither exact nor prefix registry match (e.g. `liquid-glow`)
- **THEN** no renderer is created and the theme's CSS-driven visuals continue to work

### Requirement: Safe fallback chain

The system SHALL degrade progressively — WebGL2, then Canvas2D for the same effect, then a static frame or no canvas — and a visual background failure MUST NOT prevent use of the application.

#### Scenario: WebGL2 unavailable
- **WHEN** `getContext("webgl2")` returns null for a GPU-preferred effect
- **THEN** the Canvas2D implementation of that effect renders instead

#### Scenario: Shader compilation fails
- **WHEN** the WebGL2 program for an effect fails to compile or link
- **THEN** the renderer construction fails closed to Canvas2D and no error surfaces in the UI

#### Scenario: Repeated context loss downgrades backend
- **WHEN** a WebGL2 context is lost and restoration fails or losses recur beyond a bounded retry budget
- **THEN** the controller swaps to the Canvas2D renderer for the active effect without a blank screen or restart loop

### Requirement: Lifecycle and resource hygiene

Renderers SHALL own their canvas element, RAF handle, timers, listeners, and GPU resources, and SHALL fully release them on disposal; at most one render loop SHALL be active per backdrop.

#### Scenario: Theme switching leaks nothing
- **WHEN** the user switches from a WebGL2-rendered theme to another animated theme
- **THEN** the previous renderer's RAF loop, GL resources, canvas element, intervals and listeners are disposed before the new renderer starts

#### Scenario: Unmount stops all activity
- **WHEN** the backdrop component unmounts
- **THEN** no RAF callback, interval, resize listener, `.anim-flash` DOM node, or GL context from the backdrop remains

#### Scenario: No duplicate loops across setting changes
- **WHEN** density, brightness, battery state, visibility, or animation settings change
- **THEN** the renderer is re-created or reconfigured exactly once per change and only one loop runs

### Requirement: Reduced motion and animation toggle

When `prefers-reduced-motion: reduce` matches OR `interface.animationsEnabled` is false, the system SHALL render at most one static frame and SHALL NOT schedule any requestAnimationFrame callbacks.

#### Scenario: Static frame without RAF
- **WHEN** reduced motion is active on a WebGL2-migrated theme
- **THEN** exactly one frame is drawn at a fixed time and zero RAF callbacks are scheduled

#### Scenario: Non-static Canvas2D effects honor the guard
- **WHEN** animations are disabled on a Canvas2D-only effect that does not declare `supportsStatic`
- **THEN** no canvas is mounted, matching the pre-existing behavior

### Requirement: Battery-aware and mobile quality tiers

The system SHALL apply tiered frame budgets — fps, render scale and density — for desktop-AC, desktop-battery, mobile and mobile-battery, with mobile tiers substantially more conservative than desktop, and native mobile SHALL keep animated themes default-off.

#### Scenario: Battery halves Canvas2D density
- **WHEN** a laptop reports it is on battery with a Canvas2D effect active
- **THEN** particle density is reduced to half while fps stays 30

#### Scenario: Mobile quality is bounded
- **WHEN** a native mobile device runs a WebGL2 effect with animations enabled
- **THEN** fps does not exceed 24, render scale does not exceed 0.6, and density does not exceed 0.6 of the user setting while on AC, and drops further on battery

### Requirement: Bounded backing resolution

The WebGL2 backend SHALL size its backing store as CSS size × clamped devicePixelRatio × render scale with hard caps on axis length and total pixels, and SHALL tolerate zero-size canvases without allocating.

#### Scenario: High-DPI phone stays bounded
- **WHEN** a 3× DPR phone viewport requests a WebGL2 backdrop
- **THEN** the backing store is computed with a DPR cap and render scale so total pixels remain well below the hard cap and the CSS size is unaffected

#### Scenario: Zero-size viewport
- **WHEN** the host element measures 0×0 during startup or teardown
- **THEN** no GL viewport or allocation is attempted and no error propagates

### Requirement: Adaptive frame pacing

Render loops SHALL pace frames by timestamp against the tier's fps target, SHALL NOT assume fixed intervals, and sustained frame-cost overshoot on WebGL2 SHALL step quality down (fps, then render scale) with cooldown rather than stutter.

#### Scenario: Slow GPU degrades instead of stuttering
- **WHEN** measured median frame cost exceeds 1.5× the frame budget for a sustained window
- **THEN** quality steps down one level with a cooldown and the degradation is recorded in diagnostics

### Requirement: Background suspension

Animated rendering SHALL stop when the window/document is hidden or unfocused, when the backdrop is suspended, or when animations are disabled, and SHALL resume cleanly without duplicated loops.

#### Scenario: Hidden document tears down the loop
- **WHEN** `visibilitychange` reports the document hidden
- **THEN** the render loop stops and no CPU/GPU work continues for the backdrop

### Requirement: Input validation

The renderer layer SHALL reject non-finite numeric inputs and out-of-range densities before they reach draw calls or uniforms.

#### Scenario: NaN never reaches a uniform
- **WHEN** a computed density or time value is NaN or Infinity
- **THEN** a sanitized fallback value is used and rendering continues

### Requirement: Local-only diagnostics

The system SHALL expose a diagnostics snapshot — backend, requested/measured fps, dropped frames, frame-cost mean/p95, resolution and render scale, density, battery/reduced-motion/visibility state, and WebGL2 availability — as `window.__plethoraAmbientDiagnostics` only in development builds or behind a localStorage opt-in, and SHALL NOT transmit it anywhere.

#### Scenario: Diagnostics available in dev only by default
- **WHEN** a production build runs without the localStorage opt-in
- **THEN** no diagnostics object is exposed on `window`

### Requirement: Theme and settings compatibility

The change SHALL NOT alter theme ids, persisted settings schema or their meaning; every pre-existing `backgroundAnimation` id SHALL keep rendering.

#### Scenario: Old theme ids keep working
- **WHEN** a theme written before this change specifies `backgroundAnimation: "plasma"`
- **THEN** it renders through the new registry (WebGL2 when available) with no user-data migration
