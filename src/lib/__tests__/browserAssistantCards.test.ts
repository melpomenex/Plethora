import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database", () => ({
  getExtract: vi.fn(),
  getDocument: vi.fn(),
  createLearningItem: vi.fn(),
}));

import * as db from "../database";
import { createBrowserAssistantCard } from "../browserAssistantCards";

describe("browser assistant card creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.getExtract).mockResolvedValue({ id: "ex", document_id: "doc" } as db.Extract);
    vi.mocked(db.getDocument).mockResolvedValue({ id: "doc" } as db.Document);
    vi.mocked(db.createLearningItem).mockImplementation(async (item) => ({ ...item, id: "saved" }) as db.LearningItem);
  });

  it("resolves extract conversations and returns a usable receipt", async () => {
    const receipt = await createBrowserAssistantCard("qa", { document_id: "extract:ex", question: "Q?", answer: "A" });
    expect(receipt).toMatchObject({ success: true, id: "saved", document_id: "doc", extract_id: "ex" });
    expect(db.createLearningItem).toHaveBeenCalledWith(expect.objectContaining({ document_id: "doc", extract_id: "ex" }), expect.objectContaining({ documentRevision: undefined, extractRevision: undefined }));
  });

  it("stores cloze source and rejects stale or mismatched sources without writing", async () => {
    await createBrowserAssistantCard("cloze", { document_id: "doc", text: "{{c1::answer}}", source: { document_id: "doc", excerpt: "Passage" } });
    expect(db.createLearningItem).toHaveBeenCalledWith(expect.objectContaining({ cloze_text: "{{c1::answer}}", source_reference: expect.stringContaining("Passage") }), expect.any(Object));
    vi.mocked(db.createLearningItem).mockClear();
    await expect(createBrowserAssistantCard("qa", { document_id: "other", extract_id: "ex", question: "Q", answer: "A" })).rejects.toThrow();
    await expect(createBrowserAssistantCard("qa", { document_id: "doc", question: "Q", answer: "A", source: { document_id: "other", excerpt: "Passage" } })).rejects.toThrow();
    expect(db.createLearningItem).not.toHaveBeenCalled();
  });

  it("rejects a deleted extract without writing a card", async () => {
    vi.mocked(db.getExtract).mockResolvedValue({ id: "ex", document_id: "doc", _deleted: true } as db.Extract);
    await expect(createBrowserAssistantCard("qa", { document_id: "extract:ex", question: "Q", answer: "A" })).rejects.toThrow();
    expect(db.createLearningItem).not.toHaveBeenCalled();
  });
});
