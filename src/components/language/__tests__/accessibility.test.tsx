import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageReaderHostPanel } from "../LanguageReaderHostPanel";
import { languageAnnotationStyleText } from "../../../lib/languageHighlighting";
import { languageHighlightCssToken } from "../../../lib/languageHighlighting";

vi.mock("../../../contexts/LanguageLearningHostContext", () => ({
  useLanguageLearningHost: () => ({
    snapshot: {
      hostId: "accessibility-host",
      surface: "reader",
      status: "ready",
      source: { source: { sourceType: "text", sourceId: "doc" }, contentType: "document", contentId: "doc", contentFingerprint: "fp" },
      profile: { id: "p", name: "Spanish", targetLanguage: "es", baseLanguage: "en" },
      capabilities: Object.fromEntries(["translation", "originalAudio", "tutor", "readingAssist", "practice", "peek"].map((name) => [name, { name, available: true, offline: true }])),
      epoch: 1,
    },
  }),
}));
vi.mock("../../viewer/selectionInteraction/DictionaryPeek", () => ({ DictionaryPeek: () => null }));

describe("reader language control accessibility", () => {
  it("gives every reader action a keyboard/screen-reader name and native button semantics", () => {
    render(<LanguageReaderHostPanel documentId="doc" selectedText="Hola mundo" sourceAnchor={{ sourceType: "text", sourceId: "doc" }} languageModeEnabled onLanguageModeChange={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAccessibleName();
    }
  });

  it("keeps reduced-motion and high-contrast/e-ink visual contracts explicit", () => {
    expect(languageAnnotationStyleText()).toContain("prefers-reduced-motion");
    expect(languageHighlightCssToken("new", { theme: "e-ink", highContrast: false, eInk: true, reducedMotion: true }).background).toBe("#ffffff");
    expect(languageHighlightCssToken("new", { theme: "light", highContrast: true, eInk: false, reducedMotion: false }).background).toBe("#fff200");
  });
});
