import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: any }) => void>>(),
  invoke: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  invokeCommand: (...args: unknown[]) => harness.invoke(...args),
  listen: async (event: string, handler: (event: { payload: any }) => void) => {
    const handlers = harness.listeners.get(event) ?? new Set();
    handlers.add(handler);
    harness.listeners.set(event, handlers);
    return () => handlers.delete(handler);
  },
}));

import { streamChatWithContext, streamChatWithLLM } from "../index";

function emit(event: string, payload: Record<string, unknown>) {
  for (const handler of harness.listeners.get(event) ?? []) handler({ payload });
}

function requestIdFromInvoke() {
  const call = harness.invoke.mock.calls.find(([command]) => command === "llm_stream_chat");
  return call?.[1]?.requestId as string | undefined;
}

describe("streamChatWithLLM native event ownership", () => {
  let nextFrame = 0;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    harness.listeners.clear();
    harness.invoke.mockReset();
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  it("isolates interleaved streams and flushes the last chunk before completion", async () => {
    harness.invoke.mockImplementation(async (command: string, args: { requestId?: string }) => {
      if (command !== "llm_stream_chat") return true;
      const ids = harness.invoke.mock.calls
        .filter(([name]) => name === "llm_stream_chat")
        .map(([, callArgs]) => (callArgs as { requestId: string }).requestId);
      const [first, second] = ids;
      emit("llm:stream:chunk", { requestId: first, content: "A1" });
      emit("llm:stream:chunk", { requestId: second, content: "B1" });
      emit("llm:stream:chunk", { requestId: first, content: "A2" });
      emit("llm:stream:done", { requestId: first, finishReason: "stop", usage: { promptTokens: 3 } });
      emit("llm:stream:chunk", { requestId: first, content: "late" });
      emit("llm:stream:done", { requestId: second, finishReason: "length" });
      return undefined;
    });

    const firstChunks: string[] = [];
    const secondChunks: string[] = [];
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    await Promise.all([
      streamChatWithLLM({ provider: "openai", requestId: "attempt-a", messages: [] }, {
        onChunk: (chunk) => firstChunks.push(chunk), onDone: firstDone,
      }),
      streamChatWithLLM({ provider: "openai", requestId: "attempt-b", messages: [] }, {
        onChunk: (chunk) => secondChunks.push(chunk), onDone: secondDone,
      }),
    ]);

    expect(firstChunks.join("")).toBe("A1A2");
    expect(secondChunks.join("")).toBe("B1");
    expect(firstDone).toHaveBeenCalledWith({ finishReason: "stop", responseKind: "final-text", usage: { promptTokens: 3 } });
    expect(secondDone).toHaveBeenCalledWith({ finishReason: "length", responseKind: "final-text", usage: undefined });
  });

  it("delivers a chunk received before a terminal error, then stops", async () => {
    harness.invoke.mockImplementation(async (command: string, args: { requestId?: string }) => {
      if (command === "llm_stream_chat") {
        emit("llm:stream:chunk", { requestId: args.requestId, content: "partial" });
        emit("llm:stream:error", { requestId: args.requestId, error: "provider failed" });
        throw new Error("provider failed");
      }
      return true;
    });
    const chunks: string[] = [];
    const onError = vi.fn();

    await expect(streamChatWithLLM({ provider: "openai", requestId: "attempt-error", messages: [] }, {
      onChunk: (chunk) => chunks.push(chunk), onError,
    })).rejects.toThrow("provider failed");

    expect(chunks.join("")).toBe("partial");
    expect(onError).toHaveBeenCalledWith("provider failed", undefined);
  });

  it("drops a pending render batch when the request is cancelled", async () => {
    let finishStream!: () => void;
    harness.invoke.mockImplementation(async (command: string, args: { requestId?: string }) => {
      if (command === "llm_stream_chat") {
        emit("llm:stream:chunk", { requestId: args.requestId, content: "not shown after stop" });
        return await new Promise<void>((resolve) => { finishStream = resolve; });
      }
      if (command === "llm_cancel_stream") {
        emit("llm:stream:error", { requestId: "attempt-cancel", error: "Stream cancelled", code: "cancelled" });
        return true;
      }
      return undefined;
    });

    const controller = new AbortController();
    const chunks: string[] = [];
    const onError = vi.fn();
    const run = streamChatWithLLM({ provider: "openai", requestId: "attempt-cancel", messages: [] }, {
      signal: controller.signal, onChunk: (chunk) => chunks.push(chunk), onError,
    });
    await vi.waitFor(() => expect(finishStream).toBeTypeOf("function"));
    controller.abort();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Stream cancelled", "cancelled"));
    finishStream();

    await expect(run).rejects.toThrow("Stream cancelled");
    expect(chunks).toEqual([]);
    expect(frames.size).toBe(0);
    expect(requestIdFromInvoke()).toBe("attempt-cancel");
  });

  it("uses the shared contextual command and retains model, scope, policy, and image messages", async () => {
    harness.invoke.mockResolvedValue(undefined);
    await streamChatWithContext(
      "openai",
      "selected-model",
      [{ role: "user", content: [
        { type: "text", text: "Describe this image" },
        { type: "image_url", imageUrl: "data:image/png;base64,abc" },
      ] }],
      {
        type: "document",
        scope: "document",
        documentId: "doc-1",
        content: "Source text",
        selection: "selected passage",
        configuredContextTokens: 8192,
        promptBudgetTokens: 4096,
        maxOutputTokens: 321,
      },
      { onChunk: vi.fn() },
      "provider-key",
      "https://compatible.example/v1",
      0.2,
      321,
    );

    const [command, args] = harness.invoke.mock.calls.find(([name]) => name === "llm_stream_chat_with_context")!;
    expect(command).toBe("llm_stream_chat_with_context");
    expect(args).toMatchObject({
      provider: "openai",
      model: "selected-model",
      apiKey: "provider-key",
      baseUrl: "https://compatible.example/v1",
      maxTokens: 321,
      context: { type: "document", scope: "document", documentId: "doc-1", content: "Source text", selection: "selected passage" },
    });
    expect(args.messages[0].content[1]).toEqual({ type: "image_url", imageUrl: "data:image/png;base64,abc" });
  });
});
