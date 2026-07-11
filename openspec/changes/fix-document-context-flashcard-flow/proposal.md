## Why

Document-scoped card creation is unreliable: selecting a heading with `#` can send content from the start of the document instead of the selected section, and opening Flashcard Studio context management for an EPUB can crash on nullable data. Generated cards are also reduced to opaque tool-status rows in chat, making it difficult to inspect, open, or continue working with the learning artifacts the assistant just created.

## What Changes

- Make `#` section mentions resolve against the active document's canonical extracted text and send only the selected section range (within the model budget), with explicit failure instead of silently falling back to the document beginning.
- Preserve section identity and source metadata through autocomplete selection, request construction, conversation history, and flashcard tool execution in both Document Q&A and Assistant surfaces.
- Make Flashcard Studio context state null-safe for EPUBs and other documents whose content, table of contents, chapters, search results, or restored local state may be absent or stale.
- Replace raw flashcard tool-call/status rows with a shared compact, high-quality in-chat card collection that shows useful front/back or cloze information, creation state, source context, and card count.
- Allow generated cards in chat to be opened and acted on individually, with accessible keyboard and pointer interaction and clear pending, saved, and failed states.
- Align card-creation prompting, tool parsing/execution, feedback, and recovery behavior between Document Q&A and Assistant windows so requests create inspectable cards rather than duplicated prose or opaque JSON.
- Add regression coverage for section-range resolution, EPUB null handling, tool-result normalization, and interactive card rendering.

## Capabilities

### New Capabilities
- `document-section-context`: Resolves a selected document heading to its authoritative content range and carries that focused source context into LLM and card-creation requests.
- `chat-flashcard-artifacts`: Presents flashcards created through assistant tools as compact, interactive, accessible artifacts in chat across Document Q&A and Assistant windows.
- `flashcard-context-reliability`: Provides null-safe, consistent document context selection and card-generation behavior in Flashcard Studio, including EPUB documents and restored state.

### Modified Capabilities

None.

## Impact

- Frontend section indexing and request construction in `useDocumentSections`, `sectionIndex`, Document Q&A, and Assistant context handling.
- Tool-call parsing, execution results, conversation message models/persistence, and shared chat presentation components.
- Flashcard Studio context normalization, document text extraction/loading, chapter and search context builders, and error boundaries.
- Tests for section selection and prompt payloads, assistant tool calls, chat interaction/accessibility, persisted nullable state, and EPUB context management.
- No breaking external API or new runtime dependency is expected; internal message/tool result types may gain normalized flashcard artifact and source-context fields.
