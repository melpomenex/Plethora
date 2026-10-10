import { describe, expect, it } from "vitest";
import { getAssistantAnswer, parseAssistantThinking } from "../assistantThinking";

describe("assistant thinking response parsing", () => {
  it("separates one or more thinking segments from the answer", () => {
    expect(parseAssistantThinking("Before<think>first</think>between<think>second</think>after")).toEqual({
      answer: "Beforebetweenafter",
      thinking: "first\n\nsecond",
      hasThinking: true,
      hasPendingDelimiter: false,
    });
  });

  it("buffers delimiter prefixes split across streamed chunks", () => {
    expect(parseAssistantThinking("Answer <thi")).toEqual({
      answer: "Answer ",
      thinking: "",
      hasThinking: true,
      hasPendingDelimiter: true,
    });
    expect(parseAssistantThinking("<think>reasoning</thi")).toEqual({
      answer: "",
      thinking: "reasoning",
      hasThinking: true,
      hasPendingDelimiter: true,
    });
  });

  it("keeps an unclosed segment separate and drops malformed tag fragments", () => {
    expect(parseAssistantThinking("<think>partial reasoning</thi").thinking).toBe("partial reasoning");
    expect(parseAssistantThinking("<think>partial reasoning")).toMatchObject({
      answer: "",
      thinking: "partial reasoning",
      hasThinking: true,
    });
    expect(parseAssistantThinking("answer</think> tail").answer).toBe("answer tail");
  });

  it("leaves ordinary answers unchanged and returns answer-only text", () => {
    expect(parseAssistantThinking("A plain answer")).toMatchObject({
      answer: "A plain answer",
      thinking: "",
      hasThinking: false,
    });
    expect(getAssistantAnswer("<think>private process</think>Final answer")).toBe("Final answer");
  });
});
