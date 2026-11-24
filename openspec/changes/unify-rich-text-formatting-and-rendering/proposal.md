# Change: Unify Rich-Text Formatting, List Indentation, and Assistant Math/Layout Rendering

Covers **BUG-01** (Scroll Mode bullet indentation), **BUG-02** (extract editor indentation), **BUG-12** (Scroll Mode text spacing & numbered items), **BUG-17** (AI Assistant message overflow), and **BUG-18** (AI Assistant mathematical formatting).

## Why

1. **BUG-01 & BUG-02 (List indentation):** `renderMarkdown` in `src/utils/markdown.ts` discards leading `\s*` and flattens all lists; `ExtractContentEditor` inserts literal `"• "` characters; `ExtractScrollItem` uses a bare `<textarea>` without indent/outdent or `Tab` support; `indentContent`/`outdentContent` have mid-line caret and trailing-newline bugs; and Tailwind v4 Preflight resets `ol, ul` markers/padding while `@tailwindcss/typography` is not installed.
2. **BUG-12 (Scroll Mode spacing):** `ReviewCardContent` injects HTML without preserving newlines or `<p>`/`<ul>`/`<ol>` Tailwind descendant spacing rules.
3. **BUG-17 (Assistant overflow):** Message wrappers and bubbles in `AssistantPanel.tsx` lack `min-w-0` and `break-words`; `.assistant-markdown` has no CSS rules; `.math-expression-block` lacks `max-width: 100%; overflow-x: auto;`.
4. **BUG-18 (Assistant math & currency):** `escapeHtmlFast` runs before LaTeX extraction; KaTeX HTML is substituted directly before `BOLD_RE`/`ITALIC_RE` run over it; and `LIKELY_MATH_RE` misclassifies currency ranges like `$5,000...$5,000` as math while missing simple `$x$`.

## What Changes

- **Nested list parsing & CSS typography:** Update `renderMarkdown` to emit true nested `<ul>`/`<ol>` structures based on indentation, normalize leading `• ` bullets, and add shared prose/list CSS rules in `src/index.css` so lists, paragraphs, and nested items render properly across Scroll Mode, Reviewer, and Assistant.
- **Extract editor indent/outdent:** Fix `indentContent`/`outdentContent` caret and selection handling in `ExtractContentEditor.tsx`, and wire `Tab`/`Shift+Tab` + indent/outdent controls into `ExtractScrollItem.tsx`.
- **Scroll Mode card spacing:** Add newline preservation / descendant `<p>`, `<ul>`, `<ol>` spacing in `ReviewCardContent.tsx` and `ScrollModeArticleEditor.tsx`, and fix `cloze.ts` inline wrapping.
- **Assistant layout containment:** Add `min-w-0` / `overflow-wrap: anywhere` on message wrappers/bubbles, `.assistant-markdown` rules for `<pre>`, `<code>`, `<table>`, and `max-width: 100%; overflow-x: auto;` on `.math-expression-block`.
- **Correct LaTeX vs currency pipeline:** Extract math delimiters (`$$...$$`, `\[...\]`, `\(...\)`, `$...$`) *before* `escapeHtmlFast` and Markdown inline formatting using placeholder tokens; fix currency detection so `$5,000` / `$10 - $20` are never parsed as LaTeX while `$x$` and `$f(x)$` render cleanly.
