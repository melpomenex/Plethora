### Fixed & Improved

- **Fixed PDF text selection disappearing on mouse release** — Introduced a transition guard to ignore transient collapsed selection events while committing selection state, ensuring selected text remains highlighted.
- **Fixed vertical offset in PDF text selection** — Restored absolute positioning for the PDF canvas element and applied layout resets on text layer spans, aligning invisible selectable zones exactly with the rendered PDF text.
