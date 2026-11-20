## Context

The frontend already has `AIProvider`, `runTask`, and `streamChatWithLLM`. Tutor uses chunk callbacks to preview the `content` field of a structured turn. Other chat paths still wait for a completed response. Assistant's default executor awaits `chatWithContext`, its configured on-device path explicitly disables streaming, and Library Q&A validates a completed answer and its source references. The browser backend handles buffered chat, while the Tauri stream listens on shared chunk, done, and error event names without filtering them by request. That event contract can mix replies once more chat surfaces subscribe.

## Goals / Non-Goals

The change covers the readable reply and its lifecycle wherever Plethora hosts a conversation. The existing task contracts govern standalone generation and structured artifacts, including cards invoked from a chat. Provider selection, source limits, permissions, tool execution, and structured validation retain their existing owners.

## Decisions

### Use request-scoped updates and keep the final result authoritative

Extend the existing provider and task path to carry progress and answer fragments alongside its awaited result. Give every transport event a request identity, using the Tauri stream command and cancellation registry with a request-scoped channel or consistently correlated events. Register the consumer before starting the transport, drain pending text before finalization, and release listeners and buffers on every terminal path. Use the existing render batching to limit UI updates. The terminal response must retain the finish reason, usage where available, and the distinction between answer, refusal, empty, and tool-only responses where the backend can report it.

Add streaming to the browser transport wherever its existing provider endpoint exposes incremental output. Share the normal request construction and response normalization with buffered chat so switching delivery mode preserves the endpoint, credentials, generation policy, attachments, and error handling. Use the existing cloud, Ollama, and native platform adapters according to their live capabilities. For completion-only APIs, including the current in-app NotebookLM ask bridge, pass through status and the final answer from the same operation. Recognize a stream capability mismatch before visible output and preserve the provider selection and existing retry policy. An interruption after visible output ends the attempt with an explicit retry path.

### Send contextual chat through the same preparation pipeline

Share contextual message assembly, request policy, and scope validation between `chatWithContext` and the streaming entry point. Keep the orchestrator responsible for source planning, citation mapping, and approved tool execution. Carry progress through Assistant's existing phase and text-delta event model and through the smaller chat surfaces' existing state. Send retrieval, transcript preparation, and agent tool steps as stage updates when they block the reply. Only the user-facing answer step contributes text to the reply.

### Classify output before it reaches a chat renderer

Route provider-declared answer text separately from tool-call, reasoning, and metadata events. For protocols that mix text and tool markup in one string, filter them incrementally with a bounded, attempt-local buffer. Reuse the existing tool-call and thinking grammar. Hold ambiguous prefixes, fenced tool or JSON blocks, and bare payload candidates until they can be safely classified. Apply the same visibility rules to final output, including malformed or unclosed tool payloads. Preserve ordinary Markdown and intentional code examples once identified as answer content. Parsing a preview has no path to tool execution or persistence.

For chat tasks whose wire format is structured, expose a schema-specific preview of the answer field only where its boundaries can be identified safely. Tutor's existing `content` preview demonstrates the pattern. Library Q&A and other wrapped replies continue applying full validation before history, active citations, and message actions become available. For native or opaque envelopes that return a complete result only, report waiting or validation and present the existing validated result.

### Keep one visible reply per attempt

Bind updates to the conversation and active attempt, using existing request and conversation guards. Keep temporary text in the view state and replace it in place with the accepted final message. Preserve focus and scroll anchoring, provide a concise live status for stage changes, and use the existing stop and retry controls or add a Stop action where the chat lacks one. Clearing or switching context detaches the old view. Cancellation aborts where supported, and stale updates can neither render nor commit. For task coalescing, share progress only with callers that already share the same authorized request, replay the current preview to a joining subscriber, and stop the provider only when the last subscriber leaves.

## Risks / Trade-offs

- Text and control markers can span chunks. Prefer delaying an ambiguous fragment until it can be classified, and cover every split point in representative text, envelopes, Markdown, and tool calls.
- Request builders, retries, and parsers differ by runtime. Compare streaming and buffered requests for provider, model, context, attachments, and scope, and exercise cancellation, empty completions, refusal, and stream failure in both transports.
- Small chunks can cause excessive rendering or disrupt reading. Reuse batched rendering and follow the latest message only when the user is already at the end.
- A task's preliminary model call might produce seemingly readable prose. Test multi-step chat so source summaries, agent planning, and validation repair appear only as progress.

## Migration Plan

Land and test the transport and preview filter first. Wire the existing chat flows in groups, starting with shared Assistant and Q&A paths, then verify the remaining chat inventory against the same behavior. Keep the persisted conversation shape and existing buffered entry points so older conversations load normally and a chat integration can be rolled back without a data migration.
