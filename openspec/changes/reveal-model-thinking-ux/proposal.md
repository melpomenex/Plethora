## Why

Ollama models can stream `<think>…</think>` content directly into chat transcripts, where it currently looks like an ordinary assistant answer and may expose raw control tags. Users need a clear, consistent way to recognize that the model is working, inspect this content when they choose, and distinguish it from the final response on every conversational AI surface.

## What Changes

- Parse thinking segments from streamed and completed model output, keeping them separate from the user-facing answer and preventing raw `<think>` tags from appearing in rendered chat.
- Show thinking in a compact, expandable section with a clear in-progress state while the model is generating and a completed state afterward.
- Apply the same presentation and interaction to the assistant panel, document Q&A, and other AI chat surfaces that render conversational responses.
- Preserve ordinary answer rendering for responses without thinking segments and handle incomplete or malformed streamed tags without displaying broken markup.

## Capabilities

### New Capabilities
- `assistant-thinking-display`: Parse and present model thinking content separately from answers across conversational AI surfaces.

### Modified Capabilities

## Impact

- Shared AI response parsing/streaming and chat message rendering in the React frontend.
- Assistant panel and document Q&A chat surfaces, plus other conversational AI surfaces using the shared renderer.
- No provider API or persistence changes are expected; thinking and answer content remain parts of the response presentation unless existing chat storage requires a representation update.
