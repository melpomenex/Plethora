## Purpose

Provide a local, accessible way to create a stable Plethora theme from an animated GIF and use the animation as a controllable application backdrop.

## ADDED Requirements

### Requirement: Local and bounded GIF import

Create Theme from Image SHALL accept multi-frame GIFs via file selection or drop and identify GIF content from its signature and validated frame structure. The app SHALL process GIFs locally off the UI thread, report progress, and support replacement or cancellation. Preparation SHALL enforce input byte, frame, dimension, duration, expanded-pixel, output byte, and elapsed-time limits before allocating or retaining data beyond those limits. Corrupt, unsupported or unsafe media MUST NOT enter playback.

#### Scenario: GIF with missing or generic MIME type
- **WHEN** a user drops a valid GIF89a with multiple frames and generic or empty MIME metadata
- **THEN** the app prepares an animation and a static poster through the existing creator without network requests

#### Scenario: Still or mislabeled image
- **WHEN** a valid one-frame GIF is selected
- **THEN** the app uses the static-image flow
- **AND** an invalid file presented as a GIF receives a format error and does not change the active theme

#### Scenario: Truncated or malformed GIF
- **WHEN** a GIF ends inside a data block, describes a frame outside its logical screen, or contains invalid compressed frame data
- **THEN** the app reports an actionable error, releases preparation resources, and leaves the committed theme selected

#### Scenario: Large input breaches a safety limit
- **WHEN** the input exceeds 16 MiB, has a logical screen beyond 2,048 px on an axis or 2,073,600 pixels, has more than 450 frames, or exceeds the declared timeline or pixel work limit
- **THEN** the app rejects it before allocating decoded frame output beyond the limit
- **AND** the creator remains responsive and accepts a replacement

#### Scenario: Valid GIF cannot be prepared for playback
- **WHEN** local analysis succeeds but animation preparation exceeds its rendition budget or cannot produce a supported animation
- **THEN** the app offers a still theme from the available poster and derived colors with a reason
- **AND** when no valid poster can be prepared, it reports a bounded import failure and leaves the existing theme usable

### Requirement: Representative synthesis and stable colors

The app SHALL derive a deterministic palette from a bounded duration-weighted sample of composited presentation frames and SHALL reuse the existing image-theme mood, variant and accent controls. Transparent pixels SHALL contribute according to visible coverage. The theme's applied color tokens SHALL remain stable across animation frames until the user makes a theme or style change.

#### Scenario: A later scene dominates the cycle
- **WHEN** a short blue opening gives way to a longer, substantially green scene
- **THEN** green has greater influence on the analyzed palette than blue
- **AND** repeated imports of the fixture produce the same palette and suggested variant

#### Scenario: Transparency and partial updates
- **WHEN** a GIF uses transparent patches, restore-background or restore-previous disposal
- **THEN** palette sampling and playback reflect the displayed composition rather than isolated patch rectangles
- **AND** transparent padding contributes no synthetic black pixels to the palette

#### Scenario: User adjusts theme controls
- **WHEN** the user changes mood, variant or primary accent
- **THEN** the actual app preview updates to the derived tokens without repeating GIF decoding
- **AND** advancing frames alone does not recompute or reapply theme tokens

### Requirement: Preview and explicit commit

The existing creator SHALL apply prepared colors and the eligible moving backdrop to the app during preview. Asset preparation and playback SHALL have a single current owner. Preview state and bytes SHALL stay temporary until the user saves. Changeable blur, brightness, scrim and surface settings SHALL use the existing theme controls and update a prepared preview without restarting its timeline.

#### Scenario: Live preview on wide and compact layouts
- **WHEN** a GIF finishes preparation while animation is permitted
- **THEN** the actual app shell shows one live backdrop, while creator thumbnails and swatches show a still
- **AND** the experience is available in the desktop dialog and mobile sheet with labeled controls and accessible status

#### Scenario: Replace or cancel in flight
- **WHEN** a user selects a second file while the first is preparing, or dismisses the creator before save
- **THEN** the earlier job cannot apply a later result, and cancellation restores the committed theme
- **AND** the abandoned jobs, previews and temporary assets are released without persistent asset writes

#### Scenario: Adjust style during active preview
- **WHEN** the user adjusts blur, brightness, scrim or surface opacity during playback
- **THEN** the existing preview session applies the change with any disclosed accessibility cap
- **AND** it performs no preparation rerun, visual timeline reset, or persistent preview write

#### Scenario: Previews in the picker
- **WHEN** the user browses saved themes by pointer or keyboard focus
- **THEN** their poster and colors preview with the existing revert behavior
- **AND** a saved animation begins only after explicit selection, subject to playback policy

### Requirement: Durable local theme and media lifecycle

Saving SHALL make the resolved theme tokens and local backdrop durable before confirming selection. Assets SHALL be independently recoverable when the animation rendition is missing or corrupt. Deletion or replacement SHALL remove unreferenced owned assets, preserve still-referenced assets, and release the previous playback owner. The app SHALL continue to read legacy still themes without a data rewrite.

#### Scenario: Save, restart and reselect
- **WHEN** the user saves a prepared GIF theme, restarts Plethora, switches to another theme and explicitly returns
- **THEN** its saved palette, poster, appearance settings and animation preference are restored without reading the original GIF or reanalyzing it

#### Scenario: Failure during durable save
- **WHEN** IndexedDB is unavailable, quota is exceeded, a transaction aborts, or theme metadata cannot be saved
- **THEN** no incomplete custom theme is reported as saved
- **AND** the previous selection and its assets remain recoverable while the creator offers a retry or cancellation

#### Scenario: Replace or delete with outstanding references
- **WHEN** a user replaces an existing backdrop or deletes a theme
- **THEN** the active session stops using the removed identity and durable cleanup deletes only assets confirmed to have no saved reference
- **AND** any ambiguous or retryable cleanup leaves referenced assets intact

#### Scenario: Existing static theme
- **WHEN** Plethora reads a theme with a legacy still-image record and no animation descriptor
- **THEN** it continues to render, preview, save and delete through the usual workflow

### Requirement: Explicit theme portability

Theme JSON export SHALL disclose the portability of locally stored backdrop imagery before writing the export. Animated image theme JSON SHALL preserve theme colors and ordinary options without including local poster references, animation references or source assets. Theme JSON import SHALL reject unsafe media URLs and SHALL NOT attach an external animation record to local media.

#### Scenario: Export a GIF theme to another installation
- **WHEN** an animated image theme is exported and imported on a device without its local assets
- **THEN** export identifies the result as colors only and import applies the saved theme colors with a theme-colored backdrop

#### Scenario: Untrusted imported media metadata
- **WHEN** JSON contains a guessed local media ID, a remote backdrop URL, or a malformed thumbnail
- **THEN** no referenced media loads and no existing local animation is acquired, overwritten or deleted by the imported metadata

### Requirement: Predictable controllable playback

Only one animation owner SHALL present per app backdrop. Playback SHALL preserve aspect ratio, transparency, normalized cycle duration and finite or infinite repeat intent within the bounded rendition cadence. The app SHALL use the poster during unavailability or a runtime error, then theme fill if no usable poster is available. Unsupported media SHALL NOT cause retry loops or stale painting.

#### Scenario: Capped rendition respects timing and repeats
- **WHEN** a supported GIF has frames closer together than the current tier interval and has a finite loop count
- **THEN** frame changes are limited to 20 per second on desktop and 12 per second on a mobile tier, skipped transitions do not speed up the cycle, and the final frame holds without further scheduling

#### Scenario: Switch while a decode is pending
- **WHEN** a user changes themes or closes a live preview before the next frame resolves
- **THEN** the previous owner is stopped before the new one starts
- **AND** any late result is released without being painted or triggering callbacks for the prior session

#### Scenario: Unsupported decoder or corrupt saved rendition
- **WHEN** an asset cannot be played by the available WebView or its stored frame data fails validation or decode
- **THEN** the theme displays the saved poster, falling back to theme fill if the poster also fails
- **AND** the app reports a local fallback reason and schedules no automatic retry loop

### Requirement: Motion, background and power policy

The app SHALL apply the existing global animation preference, the per-theme animation preference, OS and app reduced motion, foreground eligibility, and power/thermal policy before requesting frames. Native mobile SHALL retain the existing default-off behavior and require global opt-in. When motion is blocked, there SHALL be no newly requested frame decoding or app-owned animation scheduling. E-ink or explicit backdrop suspension SHALL honor the shell's existing decorative backdrop suppression.

#### Scenario: Global or per-theme preference changes
- **WHEN** either animation switch is turned off on an active image theme
- **THEN** its poster and stable palette remain visible and no further frame decode or animation callback is scheduled
- **AND** later enabling both switches starts eligible playback without a new import

#### Scenario: Reduced motion at launch or changes live
- **WHEN** OS reduced motion or Plethora's forced reduced-motion preference applies
- **THEN** the user sees the saved poster before any animated frame paints
- **AND** disabling the policy preserves the theme selection and can restore eligible animation

#### Scenario: Battery Saver or thermal protection
- **WHEN** the app detects battery discharge, low-power mode or severe thermal pressure on an eligible platform
- **THEN** automatic quality uses the poster and stops requesting frames without changing saved preferences

#### Scenario: Focus and visibility events arrive in either order
- **WHEN** a window is unfocused or the app is hidden, minimized, backgrounded or suspended
- **THEN** ongoing scheduling stops and no stale async work paints
- **AND** a visible event alone does not resume playback while an applicable focus or app lifecycle gate remains closed
- **AND** once eligible again, temporary interruption resumes from the parked position, excluding background wall time

#### Scenario: Fresh native mobile profile
- **WHEN** a user on a fresh native Android or iOS profile previews or selects an imported animated theme
- **THEN** it is static until they explicitly opt in through the existing global control
- **AND** a later eligible mobile session uses the more conservative mobile rendition

### Requirement: Legible and motion-safe reading surfaces

The animation SHALL be decorative, inert, and behind application content. Effective backgrounds under reading text, controls, navigation, dialogs and popovers SHALL preserve foreground contrast through protected surfaces, tone adjustment or a still fallback. Normal text and links SHALL achieve at least 4.5:1, qualifying large text at least 3:1, and essential control and focus indicators at least 3:1 against adjacent effective colors. The app SHALL keep media classified as high flashing risk still-only.

#### Scenario: Bright and dark regions move behind UI
- **WHEN** the animation cycles between bright and dark regions, including near the user's lowest requested scrim and surface opacities
- **THEN** protected reader content remains opaque and relevant controls and text retain their contrast thresholds
- **AND** an adjusted effective opacity is explained in the image creator

#### Scenario: Unsafe flashing fixture
- **WHEN** preparation classifies a repeated red or luminance flash as high risk, including a loop seam
- **THEN** Plethora offers a still and explains why motion is unavailable before any animated preview occurs

### Requirement: Bounded resources and local diagnostics

The app SHALL keep playback resources bounded independent of source frame count and display pixel ratio. It SHALL release timers, workers, listeners, frame buffers, object URLs and other owned resources on suspension, cancellation or disposal as applicable. Playback diagnostics SHALL remain local and use the existing development or opt-in convention.

#### Scenario: Resize or switch repeatedly
- **WHEN** a user resizes a high-DPI window and alternates between animated, static and procedural themes
- **THEN** at most one active playback canvas, one pending frame decode and two app-owned decoded playback frames are retained
- **AND** detached players leave no owned work or decoded buffers behind after any already-issued browser decode settles

#### Scenario: Diagnostics in production
- **WHEN** diagnostic opt-in is absent in a production build
- **THEN** no public animated-image diagnostics snapshot is exposed
- **AND** opt-in or development snapshots contain only local performance and fallback information

### Requirement: Searchable saved animation control

The saved theme's animation control SHALL have a stable Settings Search destination. Selecting a result SHALL reveal the eligible control or its prerequisite explanation without changing a setting or starting an import.

#### Scenario: Find the control with and without an active animated theme
- **WHEN** the user searches Appearance for an image theme's playback control
- **THEN** Settings Search navigates to the active saved theme control when eligible and otherwise reveals the existing image-theme entry point with prerequisite context
