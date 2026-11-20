import { describe, expect, it } from "vitest";
import { AssistantAnswerStreamFilter } from "../answerStreamFilter";

const tools = ["create_qa_card", "create_cloze_card", "batch_create_cards"];

describe("AssistantAnswerStreamFilter", () => {
  it("withholds reasoning delimiters and content at every split point", () => {
    const raw = "Visible answer. <think>private reasoning</think> More answer.";
    for (let split = 0; split <= raw.length; split += 1) {
      const filter = new AssistantAnswerStreamFilter(tools);
      const snapshots = [filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()];
      for (const visible of snapshots) {
        expect(visible, `split at ${split}`).not.toContain("private reasoning");
        expect(visible).not.toContain("<think>");
        expect(visible).not.toContain("</think>");
      }
      expect(filter.finish()).toContain("Visible answer.");
    }
  });

  it("hides native-style fenced, fenced JSON, and bare tool payloads", () => {
    const payload = '{"name":"create_qa_card","arguments":{"question":"secret question","answer":"secret answer"}}';
    const cases = [
      `Before\n\`\`\`tool_calls\n[${payload}]\n\`\`\`\nAfter`,
      `Before\n\`\`\`json\n${payload}\n\`\`\`\nAfter`,
      `Before ${payload} After`,
    ];
    for (const raw of cases) {
      for (let split = 0; split <= raw.length; split += 1) {
        const filter = new AssistantAnswerStreamFilter(tools);
        const snapshots = [filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()];
        for (const snapshot of snapshots) {
          expect(snapshot).not.toContain("secret question");
          expect(snapshot).not.toContain('"name"');
        }
        const final = snapshots.at(-1) ?? "";
        expect(final).toContain("Before");
        expect(final).toContain("After");
      }
    }
  });

  it("never previews Flashcard Studio card payloads across split points", () => {
    const payloads = [
      '{"name":"create_qa_card","arguments":{"question":"secret question","answer":"secret answer"}}',
      '{"name":"create_cloze_card","arguments":{"text":"secret {{c1::payload}}"}}',
      '{"name":"batch_create_cards","arguments":{"cards":[{"type":"qa","question":"secret batch question","answer":"secret batch answer"}]}}',
    ];
    for (const payload of payloads) {
      const raw = `Before ${payload} After`;
      for (let split = 0; split <= raw.length; split += 1) {
        const filter = new AssistantAnswerStreamFilter(tools);
        const snapshots = [filter.push(raw.slice(0, split)), filter.push(raw.slice(split)), filter.finish()];
        for (const visible of snapshots) expect(visible).not.toContain("secret");
        expect(filter.finish()).toContain("Before");
        expect(filter.finish()).toContain("After");
      }
    }
  });

  it("preserves completed ordinary Markdown and JSON examples", () => {
    const raw = "Use **bold** text and this example:\n\`\`\`json\n{\"question\":\"Q\",\"answer\":\"A\"}\n\`\`\`";
    const filter = new AssistantAnswerStreamFilter();
    for (const char of raw) filter.push(char);
    expect(filter.finish()).toContain("**bold**");
    expect(filter.finish()).toContain('{"question":"Q","answer":"A"}');
  });

  it("removes malformed or unclosed tool payloads from the final answer", () => {
    const malformed = "Intro\n\`\`\`json\n{\"name\":\"create_qa_card\", broken\nConclusion";
    const filter = new AssistantAnswerStreamFilter(tools);
    for (const char of malformed) filter.push(char);
    expect(filter.finish()).not.toContain('"name":"create_qa_card"');
    expect(filter.finish()).not.toContain("broken");

    const unclosed = new AssistantAnswerStreamFilter(tools);
    unclosed.push("Start\n\`\`\`tool_calls\n{broken private payload");
    expect(unclosed.finish()).toBe("Start\n");
  });
});
