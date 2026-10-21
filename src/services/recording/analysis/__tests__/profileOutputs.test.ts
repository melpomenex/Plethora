import { describe, expect, it } from "vitest";
import {
  getDefaultProfile,
  getProfileAnalysisGuidance,
  type KnownProfileType,
} from "../profiles";
import { sessionSectionAnalysisTask } from "../../../../lib/ai/tasks/definitions/sessionSectionAnalysisTask";
import { sessionOverviewTask } from "../../../../lib/ai/tasks/definitions/sessionOverviewTask";
import type { SessionSectionAnalysisResult } from "../../../../lib/ai/schemas/sessionAnalysis";
import { isFailedOutcome, isValidOutcome } from "../../../../lib/ai/schemas/common";

interface ProfileFixture {
  profile: Extract<KnownProfileType, "interview" | "seminar" | "voice-note">;
  ownedText: string;
  quote: string;
  summary: string;
  concepts: string[];
  expectedGuidance: RegExp;
  observations?: SessionSectionAnalysisResult["profileObservations"];
}

const FIXTURES: ProfileFixture[] = [
  {
    profile: "interview",
    ownedText:
      "Interviewer: What motivated the migration? Candidate: The team needed lower latency and predictable costs. " +
      "We reduced p95 latency by forty percent after moving the hot path to the edge.",
    quote: "We reduced p95 latency by forty percent after moving the hot path to the edge.",
    summary: "A migration interview covering latency and cost motivations.",
    concepts: ["Edge migration", "p95 latency"],
    expectedGuidance: /questions asked, concise answers, insights/i,
    observations: {
      questions: ["What motivated the migration?"],
      keyTakeaways: ["Moving the hot path to the edge reduced p95 latency by forty percent."],
    },
  },
  {
    profile: "seminar",
    ownedText:
      "The speaker argued that open data improves reproducibility. " +
      "The evidence came from three replicated studies, but privacy risks remain unresolved.",
    quote: "The evidence came from three replicated studies, but privacy risks remain unresolved.",
    summary: "A seminar argument about open data, reproducibility and privacy trade-offs.",
    concepts: ["Open data", "Reproducibility"],
    expectedGuidance: /arguments, supporting evidence, counterpoints/i,
    observations: {
      keyTakeaways: ["Open data improves reproducibility, but privacy risks remain."],
    },
  },
  {
    profile: "voice-note",
    ownedText:
      "Remember to renew the library books on Friday. Also book the study room for next week.",
    quote: "Remember to renew the library books on Friday.",
    summary: "A short reminder to renew books and book a study room.",
    concepts: ["Library renewal", "Study room booking"],
    expectedGuidance: /concise outline, key points and short verbatim extract/i,
    observations: {
      keyTakeaways: ["Renew library books on Friday and book the study room next week."],
    },
  },
];

describe("Additional profile output evals (Task 5.5)", () => {
  it.each(FIXTURES)(
    "$profile profiles emit grounded extracts and keep cards off by default",
    ({ profile, ownedText, quote, summary, concepts, expectedGuidance, observations }) => {
      const outputProfile = getDefaultProfile(profile, true);
      expect(outputProfile.enableCards).toBe(false);
      expect(outputProfile.enableExtracts).toBe(true);
      expect(getProfileAnalysisGuidance(profile)).toMatch(expectedGuidance);

      const input = {
        sessionId: "sess-profile-eval",
        unitKey: "unit-1",
        ownedText,
        profile,
        enableCards: outputProfile.enableCards,
        enableExtracts: outputProfile.enableExtracts,
      };

      const built = sessionSectionAnalysisTask.buildInput?.(input);
      expect(built?.text).toContain(`Session profile: ${profile}`);
      expect(built?.text).toContain(getProfileAnalysisGuidance(profile));
      expect(built?.text).toContain("Card proposals are NOT authorized");
      expect(built?.text).toContain("Verbatim extract proposals are AUTHORIZED");

      const grounded: SessionSectionAnalysisResult = {
        sectionSummary: summary,
        topics: [summary],
        concepts: concepts.map((name) => ({ name })),
        extractProposals: [{ quote, summaryNote: "Verbatim evidence from this section." }],
        cards: [],
        profileObservations: observations,
        taskVersion: "1.0.0",
      };

      const valid = sessionSectionAnalysisTask.validate?.(grounded, input);
      expect(valid).toBeDefined();
      if (valid && isValidOutcome(valid)) {
        expect(valid.value.extractProposals[0].quote).toBe(quote);
        expect(valid.value.cards).toHaveLength(0);
      } else {
        throw new Error("Expected grounded profile output to validate");
      }

      // Hallucinated evidence is rejected in every profile, not just lecture.
      const hallucinated = {
        ...grounded,
        extractProposals: [{ quote: "This sentence was never spoken in the recording." }],
      };
      const invalid = sessionSectionAnalysisTask.validate?.(hallucinated, input);
      expect(invalid).toBeDefined();
      if (invalid && isFailedOutcome(invalid)) {
        expect(invalid.errors.join(" ")).toMatch(/verbatim/i);
      } else {
        throw new Error("Expected hallucinated profile output to fail validation");
      }
    }
  );

  it("synthesizes profile observations into the bounded overview input", () => {
    const built = sessionOverviewTask.buildInput?.({
      sessionId: "sess-profile-eval",
      profile: "interview",
      enableDecisionsAndActions: false,
      summaries: [
        {
          unitKey: "unit-1",
          summary: "A migration interview covering latency and cost motivations.",
          topics: ["Migration"],
          observations: {
            questions: ["What motivated the migration?"],
            keyTakeaways: ["Edge migration reduced p95 latency."],
          },
        },
      ],
    });

    expect(built?.text).toContain("Decisions and action items are NOT authorized");
    expect(built?.text).toContain("Questions: What motivated the migration?");
    expect(built?.text).toContain("Key takeaways: Edge migration reduced p95 latency.");
    expect(built?.text).not.toMatch(/entire transcript/i);
  });
});
