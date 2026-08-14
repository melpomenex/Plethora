import { describe, expect, it } from "vitest";
import {
  checkGrounding,
  deduplicateOnDeviceCards,
  extractClozeDeletion,
  normalizeText,
  parseDelimitedFlashcardsWithEvidence,
  toGeneratedFlashcards,
  validateOnDeviceCard,
  type InternalOnDeviceFlashcard,
} from "../cardValidator";

describe("normalizeText", () => {
  it("lowercases, removes punctuation, and compresses spaces", () => {
    expect(normalizeText("  Hello,  World!  ")).toBe("hello world");
    expect(normalizeText("Q: What is 2 + 2?")).toBe("q what is 2 2");
  });
});

describe("extractClozeDeletion", () => {
  it("extracts payload from {{c1::text}} and [[c1::text]]", () => {
    expect(extractClozeDeletion("The {{c1::heart}} pumps blood.")).toBe("heart");
    expect(extractClozeDeletion("The [[c1::liver::organ]] filters blood.")).toBe("liver");
    expect(extractClozeDeletion("Plain text with no cloze.")).toBe("");
  });
});

describe("checkGrounding & validateOnDeviceCard", () => {
  const source = "The heart is a muscular organ that pumps blood throughout the human body via the circulatory system.";

  it("scores 1.0 for direct evidence quote match in source", () => {
    const card = {
      question: "What pumps blood?",
      answer: "The heart.",
      card_type: "qa" as const,
      evidenceQuote: "pumps blood throughout the human body",
    };
    const validation = validateOnDeviceCard(card, source);
    expect(validation.valid).toBe(true);
    expect(validation.grounded).toBe(true);
    expect(validation.evidenceFound).toBe(true);
    expect(validation.acceptanceScore).toBe(1.0);
  });

  it("scores grounded when key terms match source even without evidence line", () => {
    const card = {
      question: "What is the heart?",
      answer: "A muscular organ.",
      card_type: "qa" as const,
    };
    const validation = validateOnDeviceCard(card, source);
    expect(validation.valid).toBe(true);
    expect(validation.grounded).toBe(true);
    expect(validation.acceptanceScore).toBeGreaterThanOrEqual(0.6);
  });

  it("marks card ungrounded and low score when terms are not in source", () => {
    const card = {
      question: "What is quantum entanglement?",
      answer: "Non-local particle correlation.",
      card_type: "qa" as const,
    };
    const validation = validateOnDeviceCard(card, source);
    expect(validation.valid).toBe(true);
    expect(validation.grounded).toBe(false);
    expect(validation.reasons).toContain("evidence_not_grounded");
    expect(validation.acceptanceScore).toBeLessThan(0.5);
  });

  it("rejects cloze card missing deletion marker", () => {
    const card = {
      question: "The heart pumps blood.",
      answer: "heart",
      card_type: "cloze" as const,
    };
    const validation = validateOnDeviceCard(card, source);
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("missing_cloze_deletion");
  });

  it("enforces allowedTypes constraint", () => {
    const card = {
      question: "What pumps blood?",
      answer: "The heart.",
      card_type: "qa" as const,
    };
    const validation = validateOnDeviceCard(card, source, { allowedTypes: ["cloze"] });
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain("card_type_disallowed:qa");
  });
});

describe("parseDelimitedFlashcardsWithEvidence", () => {
  const source = "The heart pumps blood through the body.";

  it("parses Q, A, and EVIDENCE lines", () => {
    const completion = [
      "Q: What pumps blood?",
      "A: The heart.",
      "EVIDENCE: The heart pumps blood through the body.",
    ].join("\n");

    const cards = parseDelimitedFlashcardsWithEvidence(completion, source, ["test"]);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("What pumps blood?");
    expect(cards[0].answer).toBe("The heart.");
    expect(cards[0].evidenceQuote).toBe("The heart pumps blood through the body.");
    expect(cards[0].validation.valid).toBe(true);
    expect(cards[0].validation.evidenceFound).toBe(true);
  });

  it("retains backward compatibility with completions lacking EVIDENCE lines", () => {
    const completion = [
      "Q: What pumps blood?",
      "A: The heart.",
      "CLOZE: The {{c1::heart}} pumps blood.",
    ].join("\n");

    const cards = parseDelimitedFlashcardsWithEvidence(completion, source);
    expect(cards).toHaveLength(2);
    expect(cards[0].card_type).toBe("qa");
    expect(cards[1].card_type).toBe("cloze");
  });

  it("parses structured JSON output when model returns JSON", () => {
    const completion = JSON.stringify([
      {
        question: "What pumps blood?",
        answer: "The heart",
        card_type: "qa",
        evidenceQuote: "The heart pumps blood through the body.",
      },
    ]);

    const cards = parseDelimitedFlashcardsWithEvidence(completion, source);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe("What pumps blood?");
    expect(cards[0].validation.valid).toBe(true);
  });
});

describe("deduplicateOnDeviceCards & toGeneratedFlashcards", () => {
  it("deduplicates normalized cards across chunks", () => {
    const card1: InternalOnDeviceFlashcard = {
      question: "What pumps blood?",
      answer: "Heart",
      card_type: "qa",
      tags: [],
      validation: { valid: true, grounded: true, evidenceFound: true, reasons: [], acceptanceScore: 1.0 },
    };
    const card2: InternalOnDeviceFlashcard = {
      question: "  what pumps blood?  ",
      answer: "heart  ",
      card_type: "qa",
      tags: [],
      validation: { valid: true, grounded: true, evidenceFound: true, reasons: [], acceptanceScore: 1.0 },
    };
    const card3: InternalOnDeviceFlashcard = {
      question: "What filters blood?",
      answer: "Kidneys",
      card_type: "qa",
      tags: [],
      validation: { valid: true, grounded: true, evidenceFound: true, reasons: [], acceptanceScore: 1.0 },
    };

    const unique = deduplicateOnDeviceCards([card1, card2, card3]);
    expect(unique).toHaveLength(2);
    expect(unique[0].question).toBe("What pumps blood?");
    expect(unique[1].question).toBe("What filters blood?");
  });

  it("filters out invalid or low-acceptance cards when mapping to GeneratedFlashcard", () => {
    const validCard: InternalOnDeviceFlashcard = {
      question: "Q1",
      answer: "A1",
      card_type: "qa",
      tags: ["t1"],
      validation: { valid: true, grounded: true, evidenceFound: true, reasons: [], acceptanceScore: 0.9 },
    };
    const invalidCard: InternalOnDeviceFlashcard = {
      question: "Q2",
      answer: "A2",
      card_type: "qa",
      tags: ["t1"],
      validation: { valid: false, grounded: false, evidenceFound: false, reasons: ["evidence_not_grounded"], acceptanceScore: 0.2 },
    };

    const result = toGeneratedFlashcards([validCard, invalidCard], 0.5);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Q1");
  });
});
