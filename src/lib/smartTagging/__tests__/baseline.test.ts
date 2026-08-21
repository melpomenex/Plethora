import { describe, expect, it } from "vitest";
import { classifyDocumentBaseline } from "../baseline";
import { canonicalizeTag, normalizeForComparison, toDisplayCasing, toSingularStem } from "../normalization";
import { extractCandidatePhrases, tokenizeWords } from "../tokenizer";

describe("Smart Tagging TypeScript Baseline Engine", () => {
  describe("Tokenizer & Normalization", () => {
    it("tokenizes words and removes stopwords", () => {
      const tokens = tokenizeWords("The software and hardware were undergoing testing in 2026.");
      expect(tokens).toEqual(["software", "hardware", "undergoing", "testing", "2026"]);
    });

    it("prevents substring collisions (e.g. software does not tokenize to war)", () => {
      const tokens = tokenizeWords("Software development forward warning warfare");
      expect(tokens).toEqual(["software", "development", "forward", "warning", "warfare"]);
      expect(tokens).not.toContain("war");
    });

    it("extracts n-gram candidate phrases", () => {
      const phrases = extractCandidatePhrases("Operating systems design and machine learning algorithms.");
      expect(phrases).toContain("operating systems");
      expect(phrases).toContain("machine learning");
      expect(phrases).toContain("learning algorithms");
    });

    it("normalizes case and hyphens", () => {
      const existing = ["Computer Science", "Machine Learning"];
      expect(canonicalizeTag("computer-science", existing)).toBe("Computer Science");
      expect(canonicalizeTag("COMPUTER SCIENCE", existing)).toBe("Computer Science");
      expect(canonicalizeTag("computer_science", existing)).toBe("Computer Science");
    });

    it("consolidates singular and plural forms", () => {
      const existing = ["Operating System"];
      expect(canonicalizeTag("Operating Systems", existing)).toBe("Operating System");
    });

    it("maps known synonyms to existing taxonomy", () => {
      const existing = ["Machine Learning"];
      expect(canonicalizeTag("ML", existing)).toBe("Machine Learning");
      expect(canonicalizeTag("AI / ML", existing)).toBe("Machine Learning");
    });

    it("formats new tags in clean display casing", () => {
      expect(toDisplayCasing("cpu scheduling")).toBe("CPU Scheduling");
      expect(toDisplayCasing("differential equations")).toBe("Differential Equations");
    });
  });

  describe("Negative Domain Fixtures (False Positive Prevention)", () => {
    it("software & hardware article does NOT receive History tag", () => {
      const title = "Modern Software Architecture and Hardware Optimization";
      const body = "This guide discusses software development pipelines, hardware drivers, forward error correction, award winning architectures, and warning diagnostics.";
      const existing = [{ name: "History", itemCount: 10 }, { name: "Computer Science", itemCount: 20 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("History");
      expect(tagNames.some((t) => t === "Computer Science" || t.includes("Software"))).toBe(true);
    });

    it("cellphone & cancellations article does NOT receive Biology tag", () => {
      const title = "Handling Flight Cancellations and Cellphone Roaming";
      const body = "Users experienced unexpected cancellations when their cellphone was roaming in Europe.";
      const existing = [{ name: "Biology", itemCount: 15 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Biology");
    });

    it("programming article mentioning average latency & table does NOT receive Mathematics", () => {
      const title = "Database Query Optimization and Index Performance";
      const body = "The table stores user data. We calculate average query latency and mean response times using mathematical functions.";
      const existing = [{ name: "Mathematics", itemCount: 15 }, { name: "Databases", itemCount: 10 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Mathematics");
    });

    it("history article mentioning average citizen does NOT receive Mathematics", () => {
      const title = "Life of the Average Citizen in the Roman Empire";
      const body = "During the reign of the Roman emperors, an average citizen worked in agriculture or trades. The historical record shows centuries of stability.";
      const existing = [{ name: "Mathematics", itemCount: 10 }, { name: "History", itemCount: 20 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Mathematics");
      expect(tagNames).toContain("History");
    });

    it("legal article with death sentence does NOT receive Language tag", () => {
      const title = "Judicial Review in Capital Punishment Cases";
      const body = "The court upheld the death sentence in a landmark constitutional ruling.";
      const existing = [{ name: "Language", itemCount: 10 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Language");
    });
  });

  describe("Positive Classification Fixtures", () => {
    it("differential equations document triggers Mathematics", () => {
      const title = "Nonlinear Differential Equations and Vector Calculus";
      const body = "In this chapter, we solve boundary value problems using eigenvalues, matrix multiplication, and Fourier transform theorem proofs.";
      const existing = [{ name: "Mathematics", itemCount: 5 }];

      const result = classifyDocumentBaseline({
        title,
        headings: ["Eigenvalue Analysis"],
        body,
        existingLibraryTags: existing,
      });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).toContain("Mathematics");
      expect(result.find((r) => r.tag === "Mathematics")?.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it("Linux kernel article triggers Operating Systems", () => {
      const title = "Linux Kernel Process Management and CPU Scheduling";
      const body = "The Completely Fair Scheduler (CFS) allocates virtual runtime to threads in operating systems. Memory management involves virtual memory and page tables.";
      const existing = [{ name: "Operating Systems", itemCount: 10 }, { name: "Linux", itemCount: 8 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).toContain("Operating Systems");
    });

    it("Roman Republic article triggers History", () => {
      const title = "Fall of the Roman Republic";
      const body = "In the first century BC, political strife destabilized the Roman Republic and ancient civilization, leading to civil war and the rise of the Roman Empire.";
      const existing = [{ name: "History", itemCount: 10 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).toContain("History");
    });
  });

  describe("Taxonomy Preference & User Authority", () => {
    it("reuses existing Machine Learning tag instead of creating ML or AI/ML", () => {
      const title = "Deep Residual Learning and Convolutional Neural Networks";
      const body = "Supervised machine learning models trained on large image datasets.";
      const existing = [{ name: "Machine Learning", itemCount: 50 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).toContain("Machine Learning");
      expect(tagNames).not.toContain("AI / ML");
      expect(tagNames).not.toContain("ML");
    });

    it("preserves manual tags and does not re-suggest them", () => {
      const title = "Quantum Mechanics and Wavefunction Collapse";
      const body = "Schrodinger equation describes quantum state evolution in particle physics.";
      const existing = [{ name: "Physics", itemCount: 10 }];

      const result = classifyDocumentBaseline({
        title,
        body,
        existingLibraryTags: existing,
        manualTags: ["Physics"],
      });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Physics");
    });

    it("never re-suggests user-dismissed tags", () => {
      const title = "Quantum Mechanics and Wavefunction Collapse";
      const body = "Schrodinger equation describes quantum state evolution in particle physics.";
      const existing = [{ name: "Physics", itemCount: 10 }];

      const result = classifyDocumentBaseline({
        title,
        body,
        existingLibraryTags: existing,
        dismissedTags: ["Physics"],
      });
      const tagNames = result.map((r) => r.tag);

      expect(tagNames).not.toContain("Physics");
    });

    it("produces 0 tags when evidence is weak", () => {
      const title = "Quick notes";
      const body = "Met with John today. Remember to pick up groceries.";
      const existing = [{ name: "Mathematics", itemCount: 10 }, { name: "History", itemCount: 10 }];

      const result = classifyDocumentBaseline({ title, body, existingLibraryTags: existing });
      expect(result).toEqual([]);
    });
  });
});
