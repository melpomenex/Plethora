import { describe, expect, it, vi } from "vitest";
import { prepareBrowserContextRequest, streamBrowserLLM } from "../browserLlmTransport";

function streamResponse(parts: string[], contentType = "text/event-stream") {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": contentType } });
}

describe("browser LLM streaming transport", () => {
  it("parses segmented OpenAI SSE records and terminal usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
      '\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const chunks: string[] = [];
    const onDone = vi.fn();

    await streamBrowserLLM({
      provider: "openai", model: "gpt-test", apiKey: "key", baseUrl: "https://api.example/v1",
      messages: [{ role: "user", content: "question" }], maxTokens: 123,
    }, { onChunk: (chunk) => chunks.push(chunk), onDone });

    expect(chunks).toEqual(["Hello", " world"]);
    expect(onDone).toHaveBeenCalledWith({
      finishReason: "stop", responseKind: "final-text",
      usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-test", max_tokens: 123, stream: true });
  });

  it("forwards only Anthropic text deltas and keeps thinking and tool payloads hidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"thinking"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"internal"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"lookup"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"q\\":1}"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"text"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Answer"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])));
    const chunks: string[] = [];
    const onDone = vi.fn();

    await streamBrowserLLM({
      provider: "anthropic", model: "claude-test", apiKey: "key",
      messages: [{ role: "user", content: "question" }],
    }, { onChunk: (chunk) => chunks.push(chunk), onDone });

    expect(chunks).toEqual(["Answer"]);
    expect(onDone).toHaveBeenCalledWith({
      finishReason: "end_turn", responseKind: "final-text",
      usage: { promptTokens: 4, completionTokens: 3 },
    });
  });

  it("uses a completed response from the same endpoint without replaying it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Completed answer" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const chunks: string[] = [];
    const onDone = vi.fn();

    await streamBrowserLLM({
      provider: "openrouter", model: "chosen-model", apiKey: "key", baseUrl: "https://openrouter.example/v1",
      messages: [{ role: "user", content: "question" }], policy: { maxOutputTokens: 91 } as never,
    }, { onChunk: (chunk) => chunks.push(chunk), onDone });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual(["Completed answer"]);
    expect(onDone).toHaveBeenCalledWith({
      finishReason: "stop", responseKind: "final-text",
      usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      model: "chosen-model", max_tokens: 91, stream: true,
    });
  });

  it("keeps the buffered context request's endpoint, policy, scope, and attachments", async () => {
    const request = {
      provider: "openai" as const,
      model: "chosen-model",
      apiKey: "secret",
      baseUrl: "https://private-compatible.example/v1",
      temperature: 0.2,
      maxTokens: 321,
      messages: [{ role: "user" as const, content: [
        { type: "text" as const, text: "Describe this image" },
        { type: "image_url" as const, imageUrl: "data:image/png;base64,abc" },
      ] }],
      context: {
        type: "document" as const,
        scope: "document" as const,
        documentId: "doc-1",
        content: "A short source document.",
        selection: "short source",
        configuredContextTokens: 8192,
        promptBudgetTokens: 4096,
        maxOutputTokens: 321,
      },
      policy: { configuredContextTokens: 8192, promptBudgetTokens: 4096, outputReserveTokens: 321, maxOutputTokens: 321 },
    };
    const buffered = prepareBrowserContextRequest(request);
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(['data: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);

    await streamBrowserLLM(request, { onChunk: vi.fn() });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const streamedBody = JSON.parse(String(init.body));
    expect(url).toBe("https://private-compatible.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(streamedBody).toMatchObject({ model: buffered.model, temperature: buffered.temperature, max_tokens: buffered.maxTokens, stream: true });
    expect(streamedBody.messages).toEqual(buffered.messages.map((message) => ({ role: message.role, content: message.content })));
    expect(streamedBody.messages[0].content).toContain("A short source document.");
    expect(streamedBody.messages[1].content[1]).toEqual({ type: "image_url", imageUrl: "data:image/png;base64,abc" });
    expect(request.context.scope).toBe("document");
  });

  it("aborts a pending reader and reports cancellation without finalizing", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } })));
    const controller = new AbortController();
    const chunks: string[] = [];
    const onDone = vi.fn();
    const onError = vi.fn();
    const run = streamBrowserLLM({
      provider: "openai", apiKey: "key", messages: [{ role: "user", content: "question" }],
    }, {
      signal: controller.signal,
      onChunk: (chunk) => { chunks.push(chunk); controller.abort(); },
      onDone,
      onError,
    });

    await expect(run).rejects.toThrow();
    expect(chunks).toEqual(["partial"]);
    expect(onError).toHaveBeenCalledWith("Stream cancelled", "cancelled");
    expect(onDone).not.toHaveBeenCalled();
  });
});
