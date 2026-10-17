## Purpose

Define a reusable, static paper material that provides authentic texture, bounded resource use, safe display enhancement, and reliable fallback across Plethora surfaces.

## ADDED Requirements

### Requirement: Optional material compatibility
The system SHALL support optional registered paper material metadata on themes, SHALL preserve existing themes without material metadata, and SHALL fall back to theme colors for unsupported or malformed material references. Imported metadata MUST NOT select arbitrary remote texture resources.

#### Scenario: Existing or unknown material theme
- **WHEN** an existing theme without material metadata or a theme with an unrecognized preset is selected
- **THEN** its palette remains usable and no paper decoration or unregistered resource request occurs

#### Scenario: Material theme round trip
- **WHEN** a theme with recognized paper material metadata is exported and imported
- **THEN** its recognized material selection is preserved without requiring a source-code or document change

### Requirement: Authentic static material composition
Paper surfaces SHALL combine an opaque warm base, authentic fine fiber detail and restrained pigmentation variation. Reading surfaces SHALL additionally support independently removable horizontal ruling and a red margin where space permits. Decoration SHALL remain beneath all content and SHALL NOT alter hit testing, text selection, focus clipping, document geometry, reading order or accessible semantics.

#### Scenario: Interacting with textured prose
- **WHEN** a user selects text, follows a link, opens a selection action, or scrolls a textured reading surface
- **THEN** decoration remains visible below the content without intercepting interaction or changing anchor positions

#### Scenario: Utility surface
- **WHEN** navigation, a dialog, an input or a dense list renders in a paper theme
- **THEN** it uses an appropriate unruled warm surface with legible controls rather than decorative ruling behind every control

### Requirement: Stable responsive texture sampling
Fiber scale SHALL remain stable in CSS dimensions through viewport changes, with density variants selected within resource limits. Assets SHALL avoid visible seams, stretching, obvious repeated motifs and compression artifacts at normal device viewing scale. Scrolling SHALL NOT generate or animate texture.

#### Scenario: High density orientation change
- **WHEN** a DPR3 phone rotates or its keyboard changes the available viewport
- **THEN** fiber scale remains constant, safe-area edges remain filled, and no stretched tile or seam appears

#### Scenario: Long reading session
- **WHEN** a long document or feed is scrolled for ten minutes
- **THEN** the material remains a stable background and its retained resources do not grow in proportion to document length

### Requirement: Packaged assets and failure fallback
The material SHALL use licensed, versioned assets packaged for offline use, with recorded profiles, dimensions, hashes, byte sizes and composited color bounds. Unsupported formats, failed decode, unavailable assets or rejected resource loads SHALL degrade to a smaller compatible texture and then an opaque theme-colored surface without blocking content. Reader source URLs MUST NOT redirect trusted material resource resolution.

#### Scenario: Failed modern texture
- **WHEN** the preferred texture fails to load or decode
- **THEN** a compatible fallback is attempted once and readable paper-colored content remains visible even if that fallback also fails

#### Scenario: Offline first theme activation
- **WHEN** an installed offline-capable app opens Legal Pad while disconnected, including when that theme was not previously opened
- **THEN** packaged or precached baseline material is available, or the correct opaque paper base is displayed without network dependency or reader failure

#### Scenario: Article has a remote base URL
- **WHEN** imported content declares a different base URL
- **THEN** paper textures still resolve only from the trusted application asset location

### Requirement: SDR and wide-gamut rendering tiers
The system SHALL provide a complete sRGB SDR material on every supported platform. Display-P3 enhancement SHALL require both parser/gamut capability and verification of the packaged platform combination, SHALL preserve approved perceived paper color and readable luminance, and SHALL fail closed to SDR. High pixel density, OLED hardware and wide gamut MUST NOT be presented as HDR support.

#### Scenario: Unsupported gamut or unverified native combination
- **WHEN** P3 syntax, gamut capability or packaged-platform validation is absent
- **THEN** the full sRGB paper experience is used with no missing colors or assets

#### Scenario: Verified wide gamut
- **WHEN** a validated P3 platform displays the material
- **THEN** its paper chromaticity remains consistent with the approved sRGB appearance and the reading surface receives no artificial brightness boost

### Requirement: Verified HDR boundary
Production Legal Pad rendering SHALL remain SDR, optionally with verified wide gamut, until a separate platform-specific HDR path is demonstrated and specified. An HDR capability query, successful HDR image decode, or browser-only demonstration SHALL NOT enable production HDR. Unsupported enhancement SHALL never change reading comfort or content fidelity.

#### Scenario: Dynamic range reports high
- **WHEN** the environment reports a high dynamic range but the packaged material output path has not been physically verified
- **THEN** Legal Pad continues using the approved SDR material and does not claim HDR output

### Requirement: Accessibility overrides decoration
Forced colors, E-Ink and high-contrast preferences SHALL remove paper decoration when needed for clarity and SHALL apply effective accessible colors inside readers as well as application chrome. Reduced motion SHALL suppress transitions while permitting static paper detail. Original document media SHALL retain its colors unless the user's existing media accessibility choice explicitly overrides them.

#### Scenario: E-Ink enabled with frames open
- **WHEN** the user enables E-Ink while HTML and EPUB content is open
- **THEN** chrome and frame reading surfaces become monochrome, all paper grain/ruling/margins disappear, and source images remain unchanged by default

#### Scenario: Forced colors and reduced motion
- **WHEN** forced colors is active
- **THEN** decoration is absent and controls use appropriate system colors
- **AND** when only reduced motion is active, static texture may remain but material transitions do not animate

### Requirement: Bounded static rendering cost
Paper decoration SHALL introduce no permanent animation loop, per-scroll texture generation, needless canvas redraw or React update solely from scrolling. It SHALL obey documented asset/density/resource limits, invalidate obsolete asynchronous work on theme changes, and pass the implementation performance gate using the targets and paired methods in this change's test matrix. Proposed thresholds MUST be reported as targets until measured, and CPU benchmarks alone MUST NOT certify GPU, native memory or power results.

#### Scenario: Idle and hidden material
- **WHEN** a paper-themed app is stationary or hidden after settling
- **THEN** no continuous decorative frame scheduler or paper-attributable GPU work runs

#### Scenario: Constrained device
- **WHEN** supported resource signals indicate limited memory, data saving or low unplugged battery
- **THEN** effective material detail is reduced without changing the saved visual preference or selected reader palette

#### Scenario: Leave before decode resolves
- **WHEN** the theme changes while a material asset is still decoding
- **THEN** the obsolete result cannot reapply decoration or retain app-owned image resources on the new theme
