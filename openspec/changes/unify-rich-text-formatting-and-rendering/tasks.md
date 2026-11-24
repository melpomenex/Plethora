## 1. Markdown Nested Lists & Prose CSS (BUG-01, BUG-12)
- [ ] 1.1 Update `src/utils/markdown.ts::renderMarkdown` to support nested `<ul>`/`<ol>` lists and `• ` bullets.
- [ ] 1.2 Add `.prose` / list / paragraph CSS rules in `src/index.css` overriding Tailwind v4 Preflight resets.
- [ ] 1.3 Fix newline and list/paragraph spacing in `ReviewCardContent.tsx`, `ScrollModeArticleEditor.tsx`, and `cloze.ts`.

## 2. Extract Editor Indentation (BUG-02)
- [ ] 2.1 Fix `indentContent` / `outdentContent` mid-line caret and trailing-newline selection bugs in `ExtractContentEditor.tsx`.
- [ ] 2.2 Add `Tab`/`Shift+Tab` indentation and indent/outdent buttons to `ExtractScrollItem.tsx`.
- [ ] 2.3 Guard `CreateExtractDialog.tsx` focus-trap `Tab` handler with `event.defaultPrevented`.

## 3. Assistant Overflow & Math Rendering (BUG-17, BUG-18)
- [ ] 3.1 Add `min-w-0` and `break-words` to `AssistantPanel.tsx` message wrappers/bubbles, and add `.assistant-markdown` + `.math-expression-block` containment rules in `src/index.css`.
- [ ] 3.2 Refactor `src/utils/markdown.ts` to extract and placeholder-protect LaTeX before `escapeHtmlFast` and Markdown inline formatting, and fix `$` currency vs math disambiguation.

## 4. Regression Tests
- [ ] 4.1 Add Vitest tests for nested `ul`/`ol` rendering, `• ` bullets, `indentContent`/`outdentContent`, `ReviewCardContent` spacing, currency `$5,000` non-math, `$x$` / `rac` / matrix LaTeX, and Assistant overflow classes.
