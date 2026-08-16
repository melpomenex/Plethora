import { describe, expect, it } from "vitest";
import { QUICK_TEMPLATES, buildSystemPrompt } from "../FlashcardStudioModal";
import { TWENTY_RULES_PROMPT_TEMPLATE } from "../../../lib/ai/knowledgeFormulation";

describe("Flashcard Studio 20 Rules Integration", () => {
  it("includes 20 Rules Formulation as the first quick template", () => {
    expect(QUICK_TEMPLATES.length).toBeGreaterThan(0);
    const firstTemplate = QUICK_TEMPLATES[0];

    expect(firstTemplate.id).toBe("twenty-rules");
    expect(firstTemplate.label).toBe("20 Rules Formulation");
    expect(firstTemplate.command).toBe("/20rules");
    expect(firstTemplate.prompt).toBe(TWENTY_RULES_PROMPT_TEMPLATE);
  });

  it("injects the 20 rules guidelines into system prompt when isTwentyRules is true", () => {
    const defaultPrompt = buildSystemPrompt(10, false);
    expect(defaultPrompt).not.toContain("20 Rules of Knowledge Formulation");

    const twentyRulesPrompt = buildSystemPrompt(10, true);
    expect(twentyRulesPrompt).toContain("20 Rules of Knowledge Formulation");
    expect(twentyRulesPrompt).toContain("MINIMUM INFORMATION PRINCIPLE");
    expect(twentyRulesPrompt).toContain("NO ENUMERATIONS OR COMPLEX LISTS");
    expect(twentyRulesPrompt).toContain("COMBAT INTERFERENCE");
  });
});
