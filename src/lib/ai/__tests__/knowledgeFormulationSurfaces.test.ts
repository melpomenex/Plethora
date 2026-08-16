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

describe("Knowledge Formulation 20 Rules System", () => {
  it("defines the 20 rules with comprehensive titles and descriptions", () => {
    expect(TWENTY_RULES_OF_KNOWLEDGE_FORMULATION).toHaveLength(20);

    const ruleTitles = TWENTY_RULES_OF_KNOWLEDGE_FORMULATION.map((r) => r.title);
    expect(ruleTitles).toContain("Do not learn if you do not understand");
    expect(ruleTitles).toContain("Learn before you memorize");
    expect(ruleTitles).toContain("Build upon the basics");
    expect(ruleTitles).toContain("Stick to the Minimum Information Principle");
    expect(ruleTitles).toContain("Cloze deletion is easy and effective");
    expect(ruleTitles).toContain("Use imagery");
    expect(ruleTitles).toContain("Avoid sets");
    expect(ruleTitles).toContain("Avoid enumerations");
    expect(ruleTitles).toContain("Combat interference");
    expect(ruleTitles).toContain("Prioritize (High Applicability)");
  });

  it("handles various command formats and aliases", () => {
    expect(isTwentyRulesCommand("/20rules")).toBe(true);
    expect(isTwentyRulesCommand("/20RULES")).toBe(true);
    expect(isTwentyRulesCommand("/formulate")).toBe(true);
    expect(isTwentyRulesCommand("/rules")).toBe(true);
    expect(isTwentyRulesCommand("/twenty-rules")).toBe(true);
    expect(isTwentyRulesCommand("/20rules create 5 cards for me")).toBe(true);

    expect(stripTwentyRulesCommand("/20rules create 5 cards for me")).toBe("create 5 cards for me");
    expect(stripTwentyRulesCommand("/formulate chapter 3")).toBe("chapter 3");
    expect(stripTwentyRulesCommand("/20rules")).toBe("");
  });

  it("generates prompt instructions enforcing minimum information principle and no lists", () => {
    const prompt = buildTwentyRulesSystemPrompt("Doc context");
    expect(prompt).toContain("MINIMUM INFORMATION PRINCIPLE");
    expect(prompt).toContain("NO ENUMERATIONS OR COMPLEX LISTS");
    expect(prompt).toContain("CLOZE DELETIONS AS MNEMONIC ANCHORS");
    expect(prompt).toContain("COMBAT INTERFERENCE");
    expect(prompt).toContain("REDUNDANCY FROM MULTIPLE ANGLES");
    expect(prompt).toContain("Doc context");
  });

  it("provides educational markdown for user reminder dialogs and tooltips", () => {
    const reminder = getTwentyRulesReminderMarkdown();
    expect(reminder).toContain("20 Rules of Knowledge Formulation");
    expect(reminder).toContain("Minimum Information Principle");
    expect(reminder).toContain("Understand First");
    expect(reminder).toContain("Avoid Sets");
    expect(reminder).toContain("Avoid Enumerations");
  });
});
