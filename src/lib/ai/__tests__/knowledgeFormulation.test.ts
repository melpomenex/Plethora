import { describe, it, expect } from "vitest";
import {
  TWENTY_RULES_OF_KNOWLEDGE_FORMULATION,
  TWENTY_RULES_COMMAND,
  TWENTY_RULES_ALIASES,
  TWENTY_RULES_PROMPT_TEMPLATE,
  matchTwentyRulesCommand,
  isTwentyRulesCommand,
  stripTwentyRulesCommand,
  buildTwentyRulesSystemPrompt,
  getTwentyRulesReminderMarkdown,
} from "../knowledgeFormulation";

describe("knowledgeFormulation", () => {
  it("contains all 20 rules of knowledge formulation with details", () => {
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION).toHaveLength(20);
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION[0].id).toBe(1);
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION[0].title).toBe("Do not learn if you do not understand");
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION[3].title).toBe("Stick to the Minimum Information Principle");
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION[19].id).toBe(20);
  });

  it("accurately matches /20rules and alias commands", () => {
    expect(matchTwentyRulesCommand("/20rules")).toEqual({
      isMatch: true,
      matchedCommand: "/20rules",
      query: "",
    });

    expect(matchTwentyRulesCommand("/formulate create 5 cards")).toEqual({
      isMatch: true,
      matchedCommand: "/formulate",
      query: "create 5 cards",
    });

    expect(matchTwentyRulesCommand("/twenty-rules focusing on chapter 2")).toEqual({
      isMatch: true,
      matchedCommand: "/twenty-rules",
      query: "focusing on chapter 2",
    });

    expect(matchTwentyRulesCommand("/rules")).toEqual({
      isMatch: true,
      matchedCommand: "/rules",
      query: "",
    });

    expect(matchTwentyRulesCommand("regular question without command")).toEqual({
      isMatch: false,
      query: "regular question without command",
    });
  });

  it("checks command existence with isTwentyRulesCommand", () => {
    expect(isTwentyRulesCommand("/20rules")).toBe(true);
    expect(isTwentyRulesCommand("/20rules what is mitochondria?")).toBe(true);
    expect(isTwentyRulesCommand("/help")).toBe(false);
    expect(isTwentyRulesCommand("")).toBe(false);
  });

  it("strips 20 rules command prefix cleanly", () => {
    expect(stripTwentyRulesCommand("/20rules summarize chapter 3")).toBe("summarize chapter 3");
    expect(stripTwentyRulesCommand("/formulate")).toBe("");
    expect(stripTwentyRulesCommand("just regular text")).toBe("just regular text");
  });

  it("builds comprehensive system prompt with 20 rules directives", () => {
    const prompt = buildTwentyRulesSystemPrompt("Doc context here");
    expect(prompt).toContain("20 Rules of Knowledge Formulation");
    expect(prompt).toContain("MINIMUM INFORMATION PRINCIPLE");
    expect(prompt).toContain("NO ENUMERATIONS OR COMPLEX LISTS");
    expect(prompt).toContain("CLOZE DELETIONS AS MNEMONIC ANCHORS");
    expect(prompt).toContain("Doc context here");
  });

  it("returns formatted educational reminder markdown", () => {
    const reminder = getTwentyRulesReminderMarkdown();
    expect(reminder).toContain("20 Rules of Knowledge Formulation");
    expect(reminder).toContain("Minimum Information Principle");
    expect(reminder).toContain("Knowledge Darwinism");
  });
});
