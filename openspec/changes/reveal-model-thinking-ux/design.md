## Context

See proposal.md for the motivation and scope. The current user-visible failure occurs when Ollama's streamed response contains literal thinking delimiters. The feature spans response ingestion and several chat surfaces, so the presentation needs one shared representation and renderer.

## Goals / Non-Goals

**Goals:**
- Normalize thinking and answer text before rendering chat messages.
- Keep stream parsing stable when delimiters are split between chunks or generation stops mid-segment.
- Present an accessible, consistent disclosure and generation status across conversational surfaces.

**Non-Goals:**
- Changing model prompts, provider settings, or whether a model emits thinking.
- Treating thinking text as a verified explanation of the model's internal process.
- Changing non-conversational AI outputs such as summaries or generated flashcards unless they use the same conversational chat renderer.

## Decisions

### Normalize streamed response content into answer and thinking fields

Use a shared incremental parser at the conversational response boundary. It will retain only enough trailing characters to detect an opening or closing delimiter split across chunks, append content inside delimiters to thinking, and append all other content to the answer. On completion or an error that leaves the conversation visible, flush pending text deterministically and retain an open thinking segment in its disclosure, marking failed generation as interrupted. Multiple thinking segments are combined in encounter order in a single disclosure; answer text outside the segments retains its encounter order.

This avoids duplicating tag handling in each panel and prevents raw delimiters from leaking during streaming. Parsing only completed text was considered, but it leaves the current leak visible until completion and produces poor streaming feedback.

### Use one disclosure component for all chat surfaces

Render thinking as a collapsed-by-default disclosure with a concise label and an in-progress indicator while generation is active. Expanded content updates as chunks arrive; after generation, the indicator changes to completed or interrupted status. Keep the answer in the normal assistant message area. Reuse the same component and normalized response shape in the assistant panel, document Q&A, and other conversational surfaces.

Defaulting to collapsed keeps the answer readable while still making thinking available on demand. Automatically expanding during generation was considered, but it would push the answer and surrounding chat as content grows. The component must expose its label, expanded state, and status to assistive technology without announcing the full thinking text on every update.

### Preserve existing content rendering and storage contracts where possible

Only the conversational presentation pipeline consumes the normalized thinking and answer parts. Keep thinking separate from the user-visible answer in any persistence path so reloaded messages cannot expose raw tags or merge thinking into the answer. Avoid provider or database schema changes unless existing message persistence cannot retain the separated representation.

## Risks / Trade-offs

- [Delimiter-shaped text in an answer could be interpreted as a thinking boundary] → Restrict parsing to conversational model response content and test ordinary responses with unmatched or split delimiter text.
- [Thinking may contain content that should not be styled as an answer] → Keep it in the distinct labeled disclosure and use the existing safe text/markdown rendering path.
- [Each chat surface may have a separate stream lifecycle] → Route all surfaces through the shared normalized response contract and verify completion, cancellation, and failure states.
- [Large thinking segments can make the transcript heavy] → Keep the disclosure collapsed by default and avoid duplicating its full content in accessibility live announcements.

## Migration Plan

1. Add the shared incremental response normalization and disclosure presentation.
2. Route the assistant panel, document Q&A, and other conversational chat surfaces through it.
3. Preserve separated thinking and answer parts for any chat history that persists streamed responses; existing messages without delimiters continue rendering unchanged.
4. Roll back by reverting the shared normalization and presentation changes; no data migration is expected if separated content remains transient.
