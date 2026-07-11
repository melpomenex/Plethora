### Added

- **Interactive chat flashcard artifacts** — Flashcards created through assistant tools now appear as a shared, compact, accessible card collection in chat across Document Q&A and Assistant windows, showing useful front/back or cloze information, creation state, source context, and card count. Each generated card can be opened and acted on individually with keyboard and pointer interaction, with clear pending, saved, and failed states.
- **Focused document section context** — Selecting a heading with `#` now resolves to the section's actual content range from the document's canonical extracted text and carries only that focused source context (within the model budget) into LLM and card-creation requests, preserving section identity and source metadata through autocomplete selection, request construction, conversation history, and flashcard tool execution.

### Fixed & Improved

- **Reliable section-range resolution** — Resolves `#` mentions against the active document's authoritative text and sends only the selected section range, failing explicitly with a clear context-unavailable message instead of silently falling back to the document beginning when the heading is title-only, empty, stale, or mismatched.
- **Flashcard Studio EPUB null safety** — Flashcard Studio context state is now null-safe for EPUBs and other documents whose content, table of contents, chapters, search results, or restored local state may be absent or stale, preventing crashes when opening context management.
- **Consistent card-creation across surfaces** — Aligned prompting, tool parsing/execution, feedback, and recovery behavior between Document Q&A and Assistant windows so requests create inspectable cards rather than duplicated prose or opaque JSON.
- **Leaner per-platform Tauri bundles** — Split bundle resources into per-platform configs (Linux `.so`, macOS `.dylib`, Windows `.dll`) so each platform bundle only ships the native libraries it needs.
- **Regression test coverage** — Added tests for section-range resolution, EPUB null handling, tool-result normalization, and interactive card rendering.
