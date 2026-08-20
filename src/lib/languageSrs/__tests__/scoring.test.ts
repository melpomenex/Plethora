import { describe, expect, it } from "vitest";
import { createLanguageLearningDraft, scoreLanguageSuggestion } from "../index";

describe("language SRS bridge", () => {
  it("scores repeated passive evidence without creating a card", () => {
    const score = scoreLanguageSuggestion({ entryId: "e1", profileId: "p1", state: "encountered", passiveEvidence: 3, activeEvidence: 0, encounterCount: 5, lookupCount: 1, now: 100 });
    expect(score.eligible).toBe(true);
    expect(score.reasons).toContain("repeated-encounters");
    expect(score.reasons).toContain("passive-evidence");
  });

  it("keeps ignored/known/cooldown suggestions bounded", () => {
    expect(scoreLanguageSuggestion({ entryId: "e1", profileId: "p1", state: "known", passiveEvidence: 5, activeEvidence: 0, encounterCount: 5, lookupCount: 0 }).eligible).toBe(false);
    expect(scoreLanguageSuggestion({ entryId: "e1", profileId: "p1", state: "learning", passiveEvidence: 5, activeEvidence: 0, encounterCount: 5, lookupCount: 0, lastSuggestedAt: 100, now: 101 }).reasons).toEqual(["cooldown"]);
    const draft = createLanguageLearningDraft({ itemType: "flashcard", question: "Define hola", answer: "hello", provenance: { origin: "dictionary-peek", profileId: "p1", lexicalEntryId: "e1", createdAt: 1 } });
    expect(draft.draftKey).toContain("e1");
  });
});
