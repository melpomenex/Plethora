## Why

Several chat interfaces leave users looking at a spinner until the full reply is ready, making it hard to tell whether Plethora is working. Users should see readable replies as they arrive and know when the app is gathering context or waiting for the first text.

## What Changes

- Stream readable replies into the current conversation across Plethora's chat interfaces.
- Show a clear status from submission until the first readable text and during any subsequent work that has no user-facing output.
- Keep JSON envelopes, tool calls, tool arguments, and internal model output out of the reply preview. If the selected chat operation only delivers a complete answer or its readable text cannot safely be separated mid-stream, show the current stage and display the completed answer when ready.
- Keep concurrent replies, retries, and cancelled attempts isolated so a late update cannot change the wrong conversation.

## Capabilities

### New Capabilities

### Modified Capabilities

- `ai-task-architecture` gains requirements for progressive chat replies, visible generation stages, filtering internal output, and request isolation.

## Impact

- Shared AI task and provider adapters, contextual chat, and browser and Tauri transports.
- Assistant on desktop, mobile, and web, Ask Sheet, Ask Plethora, Document and Library Q&A, Tutor, and other in-app chat surfaces including NotebookLM chat and the conversational part of Flashcard Studio.
- Pending and partial-result UI, cancellation and retry handling, and coverage for supported provider and platform paths.
