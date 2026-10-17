# Using Legal Pad

In Settings → Appearance, open the theme picker and choose **Legal Pad — Archival Yellow**. The saved theme applies to app chrome and compatible reading surfaces. Theme previews revert when dismissed; selecting the theme commits it.

The Paper appearance controls appear after selecting Legal Pad:

- **Paper detail:** Subtle, Authentic (default), or Maximum. Low-memory, data-saving and low-battery hints can reduce effective detail without changing your saved choice.
- **Blue ruling:** shows horizontal rules on compatible reading surfaces.
- **Red margin:** requires ruling and a supported reading gutter. Narrow panes and right-to-left pages suppress it to protect content.
- **Reset paper appearance:** restores Authentic detail with ruling and margin enabled.

RSS's **App theme** follows Legal Pad; explicitly selected RSS palettes keep their own appearance. PDF reflow follows it when the existing reflow theme is System. Original PDF pages and fixed-layout EPUB pages preserve their source rendering. EPUB's **Original book** appearance restores publisher styling; switch back to App theme for compatible reflowable paper reading.

Textures are packaged with native builds. The web service worker caches the small baseline fallback after installation. If preferred assets cannot decode, the material tries PNG once and then uses the warm flat palette. E-Ink, forced-colors and increased-contrast modes suppress decorative textures. The current rendering tier is SDR; no HDR mode or display-brightness adjustment is provided.

To turn paper off, choose any other theme. This removes the paper material while retaining its saved preferences for your next visit. Document files, annotation identifiers and reading positions are not rewritten by this appearance choice.

Implementation acceptance is still in progress. See [validation.md](validation.md) for measured checks and outstanding platform/reader coverage.
