# Technical Design: Rich-Text Formatting and Rendering

## 1. Markdown Nested Lists & Shared Prose CSS (`BUG-01`, `BUG-12`)
- `src/utils/markdown.ts::renderMarkdown`:
  - Replace flat `listType` with an indentation stack of `{ type: "ul" | "ol", indent: number }`.
  - Recognize `- `, `* `, `+ `, `• ` for unordered items and `\d+\. ` for ordered items, preserving leading indentation width.
  - Emit nested `<ul>`/`<ol>` inside parent `<li>` elements.
- `src/index.css`:
  - Define `.prose` / `.assistant-markdown` / `.reading-prose` list and paragraph rules (`ul { list-style-type: disc; padding-left: 1.5rem; }`, `ol { list-style-type: decimal; padding-left: 1.5rem; }`, nested `ul ul { list-style-type: circle; }`, `p + p { margin-top: 0.75em; }`) so Tailwind v4 Preflight does not strip list markers or paragraph spacing.
- `src/components/review/ReviewCardContent.tsx`:
  - Preserve plain-text newlines (`whitespace-pre-wrap` or `
` -> `<br>` for plain text) and add `[&_p]`, `[&_ul]`, `[&_ol]`, `[&_li]` spacing/marker classes.

## 2. Extract Editor Indentation (`BUG-02`)
- `src/components/extracts/ExtractContentEditor.tsx`:
  - Fix `indentContent` and `outdentContent` so `start === end` indents/outdents at `lineStart` rather than mid-line at the cursor, and multiline selection with trailing `
` adjusts `newEnd` accurately.
  - Guard `CreateExtractDialog.tsx` focus-trap `Tab` handler with `if (event.defaultPrevented) return;`.
- `src/components/review/ExtractScrollItem.tsx`:
  - Support `Tab` / `Shift+Tab` indentation (using `indentContent`/`outdentContent`) and compact indent/outdent toolbar buttons in Scroll Mode editing.

## 3. Assistant Overflow & Math/Currency Pipeline (`BUG-17`, `BUG-18`)
- `src/components/assistant/AssistantPanel.tsx`:
  - Add `w-full min-w-0` to message wrapper and `min-w-0 break-words` to message bubbles.
- `src/index.css`:
  - Add `.assistant-markdown` rules (`min-width: 0; max-width: 100%; overflow-wrap: anywhere;`, `pre { overflow-x: auto; max-width: 100%; }`, `table` scrollable wrapper or `display: block; overflow-x: auto; max-width: 100%;`).
  - Add `max-width: 100%; overflow-x: auto;` to `.math-expression-block`.
- `src/utils/markdown.ts`:
  - Protect inline code (`` `...` ``) and fenced code blocks FIRST, then extract display/inline LaTeX expressions into placeholder tokens *before* `escapeHtmlFast` and before `BOLD_RE` / `ITALIC_RE` / `LINK_RE`.
  - Refine `$...$` heuristic: reject currency-like content (e.g., `$5,000` followed by prose or `$10 - $20` where `$` is immediately followed by a digit and whitespace/punctuation/currency suffix without math operators/LaTeX commands), while allowing `$x$`, `$f(x)$`, `$n+1$`, `$rac{a}{b}$`.
  - Restore LaTeX HTML tokens after inline formatting so KaTeX DOM is never mangled by Markdown regexes.
