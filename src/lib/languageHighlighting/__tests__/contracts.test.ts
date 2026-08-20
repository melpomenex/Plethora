import { describe, expect, it } from "vitest";
import {
  PlainTextLanguageHighlightAdapter,
  VisibleLanguageAnnotationIndex,
  buildVocabularyAnnotations,
  resolveAnnotationPrecedence,
  type LanguageHighlightSettings,
} from "../index";

const settings: LanguageHighlightSettings = {
  profileId: "profile-1",
  mode: "full",
  theme: "light",
  highContrast: false,
  reducedMotion: false,
  eInk: false,
  announceState: true,
};

describe("language highlighting contracts", () => {
  it("maps plain-text anchors to profile-scoped state annotations", () => {
    const adapter = new PlainTextLanguageHighlightAdapter("doc-1", "hola mundo");
    const tokens = adapter.getTokenAnchors().map((anchor, index) => ({
      id: anchor.id,
      profileId: "profile-1",
      lexicalEntryId: `entry-${index}`,
      surface: anchor.surface,
      normalized: anchor.surface.toLowerCase(),
      sourceId: anchor.sourceId,
      range: anchor.range,
      anchor: anchor.anchor,
      analysisVersion: 2,
      analysisAvailable: true,
    }));
    const annotations = buildVocabularyAnnotations({
      tokens,
      stateMap: {
        profileId: "profile-1",
        lexicalStateVersion: 4,
        states: new Map([["entry-0", "learning"], ["entry-1", "known"]]),
      },
      settings,
      expectedVersions: { analysisVersion: 2, lexicalStateVersion: 4 },
    });
    expect(annotations.map((annotation) => annotation.summary.state)).toEqual(["learning", "known"]);
    expect(annotations[0]?.ariaLabel).toContain("Learning word");
  });

  it("rejects stale versions and invalidates only changed visible ranges", () => {
    const adapter = new PlainTextLanguageHighlightAdapter("doc-1", "one two three");
    const tokens = adapter.getTokenAnchors().map((anchor, index) => ({
      id: anchor.id,
      profileId: "profile-1",
      lexicalEntryId: `entry-${index}`,
      surface: anchor.surface,
      normalized: anchor.surface,
      sourceId: anchor.sourceId,
      range: anchor.range,
      anchor: anchor.anchor,
      analysisVersion: 1,
      analysisAvailable: true,
    }));
    const index = new VisibleLanguageAnnotationIndex();
    expect(index.replaceAnalysis({ profileId: "profile-1", analysisVersion: 1, lexicalStateVersion: 1, tokens }).accepted).toBe(true);
    expect(index.invalidateLexicalStates({ profileId: "profile-1", lexicalStateVersion: 2, changedLexicalEntryIds: ["entry-1"] }).ranges).toHaveLength(1);
    expect(index.replaceAnalysis({ profileId: "profile-1", analysisVersion: 0, lexicalStateVersion: 2, tokens }).stale).toBe(true);
    expect(resolveAnnotationPrecedence({ vocabulary: true, userHighlight: true }).dominant).toBe("user-highlight");
  });
});
