## ADDED Requirements

### Requirement: Saved highlights preserve source-text readability
The PDF and EPUB readers SHALL render saved extract highlights with translucent color fills that leave the underlying text readable. The rendering SHALL NOT replace the source text's foreground color or use the current 50%-opaque saturated yellow treatment for the default highlight.

#### Scenario: Default yellow extract in a PDF
- **WHEN** a saved extract with the default yellow color is displayed in the PDF reader
- **THEN** the reader shows a clearly visible translucent yellow highlight while the text beneath it remains readable

#### Scenario: Default yellow extract in an EPUB
- **WHEN** a saved extract with the default yellow color is displayed in the EPUB reader
- **THEN** the reader shows a clearly visible translucent yellow highlight while the text beneath it remains readable

#### Scenario: Highlight in a dark reading context
- **WHEN** a saved extract is displayed over content using a dark reading theme
- **THEN** the translucent highlight preserves the content's foreground/background contrast and remains identifiable

### Requirement: Reader highlight colors are consistent across formats
The system SHALL use one canonical reader-safe rendered palette for supported saved extract colors in PDF and EPUB readers. Yellow, green, blue, pink, and purple SHALL remain visually distinguishable without any supported color using an opacity that materially obscures text.

#### Scenario: Same color in PDF and EPUB
- **WHEN** extracts with the same supported color are rendered in PDF and EPUB documents
- **THEN** both readers use the same canonical rendered color and intended alpha treatment

#### Scenario: Non-yellow supported color
- **WHEN** a saved extract uses green, blue, pink, or purple
- **THEN** the reader renders a translucent fill identifiable as that selected color without reducing text legibility

### Requirement: Existing saved colors remain compatible
The readers SHALL apply the reader-safe palette at render time without changing persisted extract color values. Existing semantic color names and known persisted pastel hex aliases SHALL resolve to their corresponding reader-safe colors.

#### Scenario: Existing semantic color value
- **WHEN** an existing extract stores a supported semantic color name
- **THEN** the reader resolves it to the corresponding reader-safe translucent fill without modifying the extract

#### Scenario: Existing pastel hex color value
- **WHEN** an existing extract stores a known pastel hex alias for a supported color
- **THEN** the reader resolves it to the corresponding reader-safe translucent fill rather than rendering an opaque block

#### Scenario: Creating a new default extract
- **WHEN** a user creates an extract and the existing default-color rules select yellow
- **THEN** the extract continues to be stored as yellow and is displayed with the reader-safe yellow treatment
