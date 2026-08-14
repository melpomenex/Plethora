import { describe, expect, it } from "vitest";
import { parseGeneratedFlashcards } from "../parseGenerated";

describe("parseGeneratedFlashcards", () => {
  it("parses well-formed Q/A and CLOZE output", () => {
    const completion = [
      "Q: What pumps blood?",
      "A: The heart.",
      "CLOZE: The {{c1::heart}} pumps blood.",
      "Q: How many chambers?",
      "A: Four.",
    ].join("\n");

    const cards = parseGeneratedFlashcards(completion, ["biology"]);

    expect(cards).toEqual([
      { question: "What pumps blood?", answer: "The heart.", card_type: "qa", tags: ["biology"] },
      {
        question: "The {{c1::heart}} pumps blood.",
        answer: "heart",
        card_type: "cloze",
        tags: ["biology"],
      },
      { question: "How many chambers?", answer: "Four.", card_type: "qa", tags: ["biology"] },
    ]);
  });

  it("drops preamble, headings, and other unclassifiable lines", () => {
    const completion = [
      "Sure! Here are your flashcards:",
      "",
      "### Cards",
      "Q: Capital of France?",
      "A: Paris.",
      "Hope that helps!",
    ].join("\n");

    const cards = parseGeneratedFlashcards(completion);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Capital of France?");
    expect(cards[0].tags).toEqual([]);
  });

  it("tolerates list markers, bold wrappers, and long labels", () => {
    const completion = [
      "1. **Question:** What is inertia?",
      "   **Answer:** Resistance to a change in motion.",
      "- CLOZE: Force equals {{c1::mass times acceleration}}.",
    ].join("\n");

    const cards = parseGeneratedFlashcards(completion);

    expect(cards.map((c) => c.card_type)).toEqual(["qa", "cloze"]);
    expect(cards[0].answer).toBe("Resistance to a change in motion.");
    expect(cards[1].answer).toBe("mass times acceleration");
  });

  it("discards a question with no answer", () => {
    const completion = ["Q: Dangling question?", "Q: Answered question?", "A: Yes."].join("\n");

    const cards = parseGeneratedFlashcards(completion);

    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("Answered question?");
  });

  it("discards an answer with no preceding question", () => {
    expect(parseGeneratedFlashcards("A: Orphaned answer.")).toEqual([]);
  });

  it("strips a cloze hint from the extracted answer", () => {
    const cards = parseGeneratedFlashcards("CLOZE: The {{c1::mitochondria::organelle}} makes ATP.");

    expect(cards[0].answer).toBe("mitochondria");
    expect(cards[0].question).toBe("The {{c1::mitochondria::organelle}} makes ATP.");
  });

  it("keeps a cloze line with no deletion markers but leaves the answer empty", () => {
    const cards = parseGeneratedFlashcards("CLOZE: Something the model forgot to mark.");

    expect(cards).toHaveLength(1);
    expect(cards[0].card_type).toBe("cloze");
    expect(cards[0].answer).toBe("");
  });

  it("returns an empty list for unusable output", () => {
    const completion = "I'm sorry, I can't help with that request.\n\nTry rephrasing?";
    expect(parseGeneratedFlashcards(completion)).toEqual([]);
  });

  it("does not share the tags array between cards", () => {
    const tags = ["shared"];
    const cards = parseGeneratedFlashcards("Q: a?\nA: b.\nQ: c?\nA: d.", tags);

    cards[0].tags.push("mutated");

    expect(cards[1].tags).toEqual(["shared"]);
    expect(tags).toEqual(["shared"]);
  });
});
