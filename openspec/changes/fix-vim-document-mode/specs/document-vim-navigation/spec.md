## ADDED Requirements

### Requirement: Vim mode exposes a stable reading caret
The reader SHALL display one visible Vim caret on navigable EPUB and PDF text, and SHALL identify its location with a stable format-specific document position rather than a transient mounted-node index.

#### Scenario: Activate on a text document
- **WHEN** the reader has focus on a text-bearing EPUB or PDF and the user activates Vim mode
- **THEN** the reader enters normal mode, places a visible caret at the current reading location, and reveals the normal-mode status

#### Scenario: No navigable text
- **WHEN** the user activates Vim mode on a PDF page for which no spatially mapped text is available
- **THEN** the reader communicates that Vim text navigation is unavailable on that surface and does not display a misleading caret

### Requirement: Motions traverse logical document text
The reader SHALL support configured Vim character/word, visual-line, line-boundary, paragraph, and document-boundary motions over logical document order, including movement across EPUB sections and PDF pages.

#### Scenario: Word motion crosses a boundary
- **WHEN** the caret is on the final word of an EPUB section or PDF page and the user invokes the forward-word motion
- **THEN** the reader reveals the next navigable region and places the caret on its first applicable word

#### Scenario: Vertical motion preserves visual intent
- **WHEN** the user repeatedly invokes a vertical motion across lines with different lengths or across a page boundary
- **THEN** the caret targets the closest available text to the user's original visual column

#### Scenario: Motion destination is not mounted
- **WHEN** a motion resolves to text outside the currently mounted reader content
- **THEN** the reader loads and reveals the destination before moving the visible caret without changing its logical identity

### Requirement: Caret position survives reader lifecycle changes
The reader SHALL preserve the logical Vim caret across EPUB reflow, font and pagination changes, PDF zoom, page virtualization, theme changes, and geometry rebuilds within the same document.

#### Scenario: EPUB reflows
- **WHEN** Vim mode is active and the user changes EPUB font size or viewport dimensions
- **THEN** the caret reappears on the same logical text after reflow

#### Scenario: PDF page is recycled
- **WHEN** the caret's PDF page is unmounted and later remounted by virtualization
- **THEN** the caret retains its page/text position and is rendered accurately when that position becomes visible

### Requirement: Asynchronous navigation remains deterministic
The reader SHALL prevent stale asynchronous page or section reveals from overwriting a newer Vim motion destination.

#### Scenario: User repeats a motion rapidly
- **WHEN** multiple motions are entered while the reader is loading destinations
- **THEN** the reader coalesces or processes them in order and renders the final logical destination without jumping back to a stale result

