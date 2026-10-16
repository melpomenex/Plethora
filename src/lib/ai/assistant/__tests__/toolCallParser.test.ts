import { describe, expect, it } from "vitest";
import {
  normalizeAssistantToolParameters,
  parseAssistantToolCalls,
} from "../toolCallParser";

const TOOLS = [
  { name: "create_qa_card" },
  { name: "create_cloze_card" },
  { name: "batch_create_cards" },
  { name: "create_extract" },
];

describe("parseAssistantToolCalls (4-stage resilient parser)", () => {
  it("parses Stage 1 fenced ```tool_calls blocks", () => {
    const input = [
      "Here are your flashcards:",
      "```tool_calls",
      JSON.stringify([
        {
          name: "create_qa_card",
          arguments: { question: "What is Q?", answer: "A" },
        },
      ]),
      "```",
    ].join("\n");

    const { cleanedContent, toolCalls } = parseAssistantToolCalls(input, TOOLS);
    expect(cleanedContent).toBe("Here are your flashcards:");
    expect(toolCalls).toEqual([
      {
        name: "create_qa_card",
        parameters: { question: "What is Q?", answer: "A" },
        status: "pending",
      },
    ]);
  });

  it("parses Stage 2 fenced ```json blocks containing recognized tool calls", () => {
    const input = [
      "Created extract:",
      "```json",
      JSON.stringify({
        name: "create_extract",
        arguments: { content: "Important passage" },
      }),
      "```",
    ].join("\n");

    const { cleanedContent, toolCalls } = parseAssistantToolCalls(input, TOOLS);
    expect(cleanedContent).toBe("Created extract:");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("create_extract");
    expect(toolCalls[0].parameters).toEqual({ content: "Important passage" });
  });

  it("parses Stage 3 fenced ```json arrays of {question, answer} objects into create_qa_card", () => {
    const input = [
      "Flashcards:",
      "```json",
      JSON.stringify([
        { question: "Q1", answer: "A1" },
        { Q: "Q2", A: "A2" },
      ]),
      "```",
    ].join("\n");

    const { cleanedContent, toolCalls } = parseAssistantToolCalls(input, TOOLS);
    expect(cleanedContent).toBe("Flashcards:");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toEqual({
      name: "create_qa_card",
      parameters: { question: "Q1", answer: "A1" },
      status: "pending",
    });
    expect(toolCalls[1]).toEqual({
      name: "create_qa_card",
      parameters: { question: "Q2", answer: "A2" },
      status: "pending",
    });
  });

  it("parses Stage 4 unfenced bare JSON tool objects and arrays", () => {
    const input =
      'Sure! {"tool_calls":[{"name":"create_cloze_card","arguments":{"text":"The {{c1::mitochondria}} is the powerhouse."}}]}';
    const { cleanedContent, toolCalls } = parseAssistantToolCalls(input, TOOLS);
    expect(cleanedContent).toBe("Sure!");
    expect(toolCalls).toEqual([
      {
        name: "create_cloze_card",
        parameters: { text: "The {{c1::mitochondria}} is the powerhouse." },
        status: "pending",
      },
    ]);
  });

  it("normalizes document_id, deck tag, and source provenance", () => {
    const params = normalizeAssistantToolParameters(
      "create_qa_card",
      { question: "Q", answer: "A", tags: ["neuroscience", "deck:OldDeck"] },
      {
        documentId: "doc-123",
        documentTitle: "Attention Is All You Need (Vaswani et al.)",
        sourceArg: { sectionId: "sec-1" },
      },
    );

    expect(params).toEqual({
      question: "Q",
      answer: "A",
      document_id: "doc-123",
      tags: ["neuroscience", "deck:Attention Is All You Need"],
      source: { sectionId: "sec-1" },
    });
  });
});
