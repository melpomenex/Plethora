import { describe, expect, it } from "vitest";
import { isWholeDocumentRequest } from "../documentIntent";

describe("isWholeDocumentRequest", () => {
  it("matches English whole-document requests", () => {
    expect(isWholeDocumentRequest("summarize this document")).toBe(true);
    expect(isWholeDocumentRequest("Give me a summary of the article")).toBe(true);
    expect(isWholeDocumentRequest("overview of the paper please")).toBe(true);
    expect(isWholeDocumentRequest("What is this document about?")).toBe(true);
    expect(isWholeDocumentRequest("tl;dr of the file")).toBe(true);
  });

  it("matches localized whole-document requests", () => {
    expect(isWholeDocumentRequest("Fasse dieses Dokument zusammen")).toBe(true);
    expect(isWholeDocumentRequest("Worum geht es in diesem Artikel?")).toBe(true);
    expect(isWholeDocumentRequest("resúmeme este documento")).toBe(true);
    expect(isWholeDocumentRequest("¿De qué trata este artículo?")).toBe(true);
    expect(isWholeDocumentRequest("fais un résumé de ce document")).toBe(true);
    expect(isWholeDocumentRequest("De quoi parle ce document ?")).toBe(true);
    expect(isWholeDocumentRequest("この文書を要約して")).toBe(true);
    expect(isWholeDocumentRequest("总结这篇文档")).toBe(true);
  });

  it("does not treat focused targets as whole-document requests", () => {
    expect(isWholeDocumentRequest("summarize this section")).toBe(false);
    expect(isWholeDocumentRequest("summarize this paragraph")).toBe(false);
    expect(isWholeDocumentRequest("summarize this passage")).toBe(false);
    expect(isWholeDocumentRequest("summarize this section of the document")).toBe(false);
    expect(isWholeDocumentRequest("Summarize this video")).toBe(false);
    expect(isWholeDocumentRequest("Explain this document")).toBe(false);
    expect(isWholeDocumentRequest("请总结这一章")).toBe(false);
    expect(isWholeDocumentRequest("")).toBe(false);
  });
});
