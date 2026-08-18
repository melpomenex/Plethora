## ADDED Requirements

### Requirement: UTF-8 Character Extraction from EPUB HTML
The EPUB extraction parser SHALL process HTML content as valid UTF-8 character sequences rather than casting raw byte values (`u8 as char`). Multi-byte UTF-8 sequences MUST be preserved exactly without introducing Latin-1 mojibake.

#### Scenario: Extracting typographic quotes and apostrophes
- **WHEN** an EPUB contains typographic punctuation such as right single quotation marks (`’`, U+2019), left/right double quotation marks (`“`, U+201C / `”`, U+201D), or apostrophes
- **THEN** the extracted text preserves `’`, `“`, and `”` verbatim and does not output `â` or other corrupted byte sequences.

#### Scenario: Extracting dashes and ellipses
- **WHEN** an EPUB contains em dashes (`—`, U+2014), en dashes (`–`, U+2013), or horizontal ellipses (`…`, U+2026)
- **THEN** the extracted text contains the exact unicode dash or ellipsis character.

#### Scenario: Extracting international scripts and accented characters
- **WHEN** an EPUB contains accented Latin characters (`café`, `naïve`, `über`, `año`) or non-Latin text (such as CJK `日本語` or Cyrillic `Привет`)
- **THEN** the extracted text preserves all accented and non-Latin characters in valid UTF-8.

### Requirement: Regression Test Coverage for Character Fidelity
The test suite SHALL include comprehensive regression fixtures containing multi-byte UTF-8 sequences, ensuring all document processors maintain character integrity during extraction, database storage, and integration export.

#### Scenario: Running Unicode extraction regression tests
- **WHEN** `cargo test processor::epub` is executed
- **THEN** unit tests verify that HTML fragments with curly quotes, em dashes, accents, and CJK text retain byte-for-byte UTF-8 identity after HTML stripping and normalization.
