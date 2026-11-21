import { describe, expect, it } from "vitest";
import {
  buildDocumentSections,
  convertPdfOutlineToSectionNodes,
  resolveSectionFocusedContext,
} from "../sectionIndex";

describe("PDF # section resolution (#10)", () => {
  it("resolves PDF outline nodes with ligatures and whitespace differences to full body text", () => {
    const outline = convertPdfOutlineToSectionNodes([
      { title: "1. Efficient Algorithms", pageNumber: 1 },
      { title: "2. Conclusion", pageNumber: 2 },
    ]);
    const pdfText = [
      "1. Ef\ufb01cient   Algorithms",
      "This section explains fast matrix multiplication and asymptotic bounds in detail across several sentences.",
      "2. Conclusion",
      "Future work will generalize these bounds to sparse tensors.",
    ].join("\n");

    const { flat } = buildDocumentSections(pdfText, outline);
    const result = resolveSectionFocusedContext(
      [flat[0]],
      flat,
      pdfText,
      { documentId: "pdf-doc-1", includeNeighbors: false },
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("asymptotic bounds in detail");
    expect(result.content).not.toContain("sparse tensors");
    expect(result.estimatedTokens).toBeGreaterThan(15);
  });

  it("ignores front-matter TOC dot-leader lines and resolves the actual chapter body", () => {
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 4: Syntax and Semantics", pageNumber: 12 },
      { title: "Chapter 5: Type Systems", pageNumber: 25 },
    ]);
    const pdfText = [
      "Table of Contents",
      "Chapter 4: Syntax and Semantics .... 12",
      "Chapter 5: Type Systems .... 25",
      "",
      "Chapter 4: Syntax and Semantics",
      "A formal grammar defines the syntactic structure of valid programs. Semantics assigns meaning to each construct.",
      "Chapter 5: Type Systems",
      "Type soundness guarantees well-typed programs cannot go wrong.",
    ].join("\n");

    const { flat } = buildDocumentSections(pdfText, outline);
    const result = resolveSectionFocusedContext(
      [flat[0]],
      flat,
      pdfText,
      { documentId: "pdf-doc-2", includeNeighbors: false },
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("formal grammar defines");
    expect(result.content).not.toContain("Type soundness");
    expect(result.estimatedTokens).toBeGreaterThan(20);
  });

  it("falls back to PDF outline pageNumber spans when heading text is absent or paraphrased", () => {
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Background", pageNumber: 1 },
      { title: "Methodology", pageNumber: 2 },
    ]);
    const pdfText = [
      "Distributed consensus protocols allow nodes to agree on a shared log despite crash faults.",
      "\f",
      "We benchmarked Raft and Paxos across a three-node cluster with simulated packet loss.",
    ].join("");

    const { flat } = buildDocumentSections(pdfText, outline);
    const result = resolveSectionFocusedContext(
      [flat[1]],
      flat,
      pdfText,
      { documentId: "pdf-doc-3", includeNeighbors: false },
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("benchmarked Raft and Paxos");
    expect(result.content).not.toContain("Distributed consensus");
  });
});
