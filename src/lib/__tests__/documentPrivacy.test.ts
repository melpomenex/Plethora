import { describe, expect, it } from "vitest";
import type { Document } from "../../types/document";
import { mergeDocumentPrivacy, normalizeDocumentPrivacy } from "../documentPrivacy";

const document = (updates: Partial<Document> = {}) => ({ id: "lecture", ...updates }) as Document;

describe("durable document privacy reconciliation", () => {
  it("promotes explicit metadata restrictions without treating absence as permission", () => {
    expect(normalizeDocumentPrivacy(document({ metadata: { isLocalOnly: true, isAiExcluded: true } })))
      .toMatchObject({ isLocalOnly: true, isAiExcluded: true });
  });

  it.each([undefined, false])("preserves cached restrictions against an older %s flag", (value) => {
    expect(mergeDocumentPrivacy(document({ isLocalOnly: value, isAiExcluded: value }), document({ isLocalOnly: true, isAiExcluded: true })))
      .toMatchObject({ isLocalOnly: true, isAiExcluded: true });
  });

  it("never weakens a native restriction from stale frontend state", () => {
    expect(mergeDocumentPrivacy(document({ isLocalOnly: true, privacyVersion: 4 }), document({ isLocalOnly: false, privacyVersion: 1 }))).toMatchObject({ isLocalOnly: true });
  });

  it("honors a newer deliberate policy change over an older restricted cache", () => {
    expect(mergeDocumentPrivacy(document({ isLocalOnly: false, privacyVersion: 3 }), document({ isLocalOnly: true, privacyVersion: 2 })))
      .toMatchObject({ isLocalOnly: false, privacyVersion: 3 });
  });

  it("retains both source restrictions during equal-version reconciliation", () => {
    expect(mergeDocumentPrivacy(document({ isLocalOnly: true, privacyVersion: 2 }), document({ isAiExcluded: true, privacyVersion: 2 })))
      .toMatchObject({ isLocalOnly: true, isAiExcluded: true });
  });
});
