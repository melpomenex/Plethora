## ADDED Requirements

### Requirement: Nested lists render with semantic hierarchy in Scroll Mode and editors

`renderMarkdown` and rich-text surfaces SHALL preserve nested unordered and ordered list structures (`<ul>`, `<ol>`, `<li>`) and visual indentation without flattening sub-items or stripping list markers.

#### Scenario: Indented sub-bullets render as nested lists
- **WHEN** extract content contains top-level and indented bullet items (using `-`, `*`, `+`, or `•`)
- **THEN** `renderMarkdown` emits nested `<ul>` elements inside parent `<li>` items with visible indentation

### Requirement: Extract editor indent and outdent operate on full lines

`indentContent` and `outdentContent` SHALL adjust indentation at line starts regardless of cursor position within the line, and Scroll Mode extract editing SHALL support `Tab`/`Shift+Tab` indentation.

#### Scenario: Indenting with caret mid-line indents the entire line
- **WHEN** the caret is in the middle of a line and the user triggers Indent or presses `Tab`
- **THEN** indentation is inserted at the beginning of that line without splitting mid-line text

### Requirement: AI Assistant messages contain wide content and distinguish currency from LaTeX

Assistant messages SHALL wrap prose within the panel width, contain wide code/tables/equations in horizontally scrollable regions, and render LaTeX math accurately without misinterpreting currency amounts as math.

#### Scenario: Currency amounts are not parsed as LaTeX math
- **WHEN** an assistant response contains `"$5,000 in cash and $15,000 left over"`
- **THEN** both currency amounts render as normal prose without KaTeX math formatting or missing spaces

#### Scenario: Matrix and inline math render cleanly
- **WHEN** an assistant response contains `\begin{pmatrix} a & b \\ c & d \end{pmatrix}` or `$f(x) = x^2$`
- **THEN** KaTeX renders the expression without HTML-entity corruption or Markdown italic mangling
