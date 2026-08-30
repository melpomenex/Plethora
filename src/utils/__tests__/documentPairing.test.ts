import { describe, expect, it } from "vitest";
import type { Document } from "../../types/document";
import {
  findCompanionDoc,
  normalizeTitleForMatching,
} from "../documentPairing";

function document(id: string, title: string, fileType: Document["fileType"]): Document {
  return {
    id,
    title,
    filePath: `/library/${title}`,
    fileType,
    isArchived: false,
  } as Document;
}

describe("document pairing", () => {
  it("normalizes common trailing audiobook labels", () => {
    expect(normalizeTitleForMatching("The Hobbit - Audiobook.m4b")).toBe("the hobbit");
    expect(normalizeTitleForMatching("The Hobbit (Unabridged).epub")).toBe("the hobbit");
  });

  it("finds an EPUB for a plain trailing audiobook filename", () => {
    const audio = document("audio", "The Hobbit - Audiobook.m4b", "audio");
    const epub = document("epub", "The Hobbit.epub", "epub");

    expect(findCompanionDoc(audio, [audio, epub]).map((match) => match.doc.id)).toEqual(["epub"]);
  });
});
