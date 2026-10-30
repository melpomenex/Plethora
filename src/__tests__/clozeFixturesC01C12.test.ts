import { describe, expect, it } from "vitest";
import {
  evaluateClozeCard,
  projectClozeCardToEditableMarkup,
  renderClozeSegmentsHtml,
  normalizeClozeSyntax,
  stripClozeMarkers,
  type ClozeCardInput,
} from "../utils/cloze";

describe("Shared Cloze Fixture Inventory (C01–C12)", () => {
  // C01: The {{c1::sun}} rises. -> Blank before reveal, sun afterward
  it("C01: basic deletion hides before reveal and reveals sun afterward", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "The {{c1::sun}} rises.",
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).toContain("data-cloze-state=\"hidden\"");
    expect(unrevealed).not.toContain("sun");
    expect(unrevealed).toContain("[...]");

    const revealed = renderClozeSegmentsHtml(evaluated, true);
    expect(revealed).toContain("data-cloze-state=\"revealed\"");
    expect(revealed).toContain("sun");
  });

  // C02: {{c1::mitochondria::cell organelle}} -> Hint before reveal; actual answer afterward
  it("C02: deletion with hint shows hint before reveal and answer afterward", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "Powerhouse: {{c1::mitochondria::cell organelle}}",
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).toContain("cell organelle");
    expect(unrevealed).not.toContain("mitochondria");

    const revealed = renderClozeSegmentsHtml(evaluated, true);
    expect(revealed).toContain("mitochondria");
  });

  // C03: {{answer}} and {{::answer}} -> Simplified formats normalize without raw markers
  it("C03: simplified formats normalize without raw markers", () => {
    const card1: ClozeCardInput = {
      item_type: "Cloze",
      question: "The capital is {{Paris}}.",
    };
    const eval1 = evaluateClozeCard(card1);
    expect(eval1.status).toBe("valid");
    if (eval1.status === "valid") {
      const html = renderClozeSegmentsHtml(eval1, false);
      expect(html).not.toContain("{{Paris}}");
      expect(html).not.toContain("{{");
    }

    const card2: ClozeCardInput = {
      item_type: "Cloze",
      question: "The capital is {{::Berlin}}.",
    };
    const eval2 = evaluateClozeCard(card2);
    expect(eval2.status).toBe("valid");
    if (eval2.status === "valid") {
      const html = renderClozeSegmentsHtml(eval2, false);
      expect(html).not.toContain("{{::Berlin}}");
      expect(html).not.toContain("{{");
    }
  });

  // C04: [[c2::answer]] -> Legacy format parity
  it("C04: legacy bracket format [[c2::answer]] parses with parity", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "Legacy format [[c2::Tokyo]] is capital.",
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.deletions[0].number).toBe(2);
    expect(evaluated.deletions[0].answer).toBe("Tokyo");

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).not.toContain("Tokyo");
    expect(unrevealed).not.toContain("[[");

    const revealed = renderClozeSegmentsHtml(evaluated, true);
    expect(revealed).toContain("Tokyo");
  });

  // C05: Explicit c1 plus simplified marker -> No normalization index collision; both hidden
  it("C05: explicit c1 plus simplified marker assigns collision-safe index and hides both", () => {
    const text = "First {{c1::alpha}} then {{beta}}.";
    const normalized = normalizeClozeSyntax(text);
    expect(normalized).toBe("First {{c1::alpha}} then {{c2::beta}}.");

    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: text,
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.deletions).toHaveLength(2);
    expect(evaluated.deletions[0].number).toBe(1);
    expect(evaluated.deletions[1].number).toBe(2);

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).not.toContain("alpha");
    expect(unrevealed).not.toContain("beta");
  });

  // C06: Repeated c1, distinct c2, multiline content -> All deletions hide/reveal on one persisted card
  it("C06: repeated c1, distinct c2 and multiline deletions hide/reveal together", () => {
    const text = "Line 1: {{c1::first}}\nLine 2: {{c1::second}}\nLine 3: {{c2::third\nwith newline}}";
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: text,
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.deletions).toHaveLength(3);

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).not.toContain("first");
    expect(unrevealed).not.toContain("second");
    expect(unrevealed).not.toContain("third");

    const revealed = renderClozeSegmentsHtml(evaluated, true);
    expect(revealed).toContain("first");
    expect(revealed).toContain("second");
    expect(revealed).toContain("third");
    expect(revealed).toContain("with newline");
  });

  // C07: Markers plus plausible but stale in-bounds ranges -> Markers win; no answer leakage
  it("C07: markers win over stale in-bounds cloze_ranges without leaking answers", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "The {{c1::correct answer}} is preserved.",
      cloze_ranges: [[4, 10]], // Stale ranges pointing to different offsets
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.mode).toBe("markers");
    expect(evaluated.deletions[0].answer).toBe("correct answer");

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).not.toContain("correct answer");
  });

  // C08: Missing/empty/out-of-bounds/overlap/noninteger ranges -> Marker fallback or explicit repair state
  it("C08: malformed ranges with no markers trigger repair_required", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "Plain text without markers.",
      cloze_ranges: [[-5, 1000]], // out of bounds
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("repair_required");
    if (evaluated.status === "repair_required") {
      expect(evaluated.reason).toBe("invalid_ranges");
    }
  });

  // C09: Marker-free valid ranges, emoji/non-ASCII -> Correct offset conversion and lossless edit projection
  it("C09: marker-free valid ranges with non-ASCII and emoji convert offsets and project losslessly", () => {
    const prompt = "Привет 🌍 мир!";
    const start = prompt.indexOf("мир");
    const end = start + "мир".length;

    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: prompt,
      cloze_ranges: [[start, end]],
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.deletions[0].answer).toBe("мир");

    const projection = projectClozeCardToEditableMarkup(card);
    expect(projection.status).toBe("valid");
    expect(projection.lossless).toBe(true);
    expect(projection.markup).toContain("{{c1::мир}}");
  });

  // C10: HTML/Markdown/LaTeX around/across deletion content -> Formatting/sanitization intact, no split invalid markup
  it("C10: HTML and formatting around deletions are preserved without splitting invalid markup", () => {
    const text = "<p>Formula: <strong>{{c1::$E=mc^2$}}</strong> and <em>{{c2::text}}</em></p>";
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: text,
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).toContain("<strong>");
    expect(unrevealed).not.toContain("E=mc^2");

    const revealed = renderClozeSegmentsHtml(evaluated, true);
    expect(revealed).toContain("<strong>");
    expect(revealed).toContain("katex");
  });

  // C11: Question-only cloze returned by batch creation -> Reachable and equivalent in every mode
  it("C11: question-only cloze with empty answer/cloze_text is reachable and equivalent", () => {
    const card: ClozeCardInput = {
      item_type: "Cloze",
      question: "The {{c1::mitochondria}} is the powerhouse of the cell.",
      answer: "",
      cloze_text: null,
    };
    const evaluated = evaluateClozeCard(card);
    expect(evaluated.status).toBe("valid");
    if (evaluated.status !== "valid") return;

    expect(evaluated.deletions[0].answer).toBe("mitochondria");
    const unrevealed = renderClozeSegmentsHtml(evaluated, false);
    expect(unrevealed).not.toContain("mitochondria");
  });

  // C12: Malformed markers or literal `[...]` without recoverable answer -> Repair/skip; no fabricated answer or grading
  it("C12: malformed markers or literal [...] without recoverable answer trigger repair_required", () => {
    // Malformed unopened/unclosed marker
    const malformed1: ClozeCardInput = {
      item_type: "Cloze",
      question: "The {{c1::answer is missing closing brace.",
    };
    const eval1 = evaluateClozeCard(malformed1);
    expect(eval1.status).toBe("repair_required");
    if (eval1.status === "repair_required") {
      expect(eval1.reason).toBe("malformed_markers");
    }

    // Literal [...] without answer
    const malformed2: ClozeCardInput = {
      item_type: "Cloze",
      question: "The [...] was signed in 1776.",
      answer: null,
      cloze_text: null,
      cloze_ranges: null,
    };
    const eval2 = evaluateClozeCard(malformed2);
    expect(eval2.status).toBe("repair_required");
    if (eval2.status === "repair_required") {
      expect(eval2.reason).toBe("placeholder_missing_answer");
    }
  });
});
