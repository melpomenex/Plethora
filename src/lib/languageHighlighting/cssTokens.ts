import type {
  LanguageHighlightSettings,
  LanguageHighlightTheme,
  VocabularyVisualCue,
  VocabularyVisualTreatment,
} from "./types";

export interface LanguageHighlightCssToken {
  ink: string;
  background: string;
  decoration: string;
  pattern: string;
}

export type LanguageHighlightCssVariables = Record<
  "--language-vocabulary-ink" | "--language-vocabulary-background" | "--language-vocabulary-decoration" | "--language-vocabulary-pattern",
  string
>;

const TOKENS: Record<LanguageHighlightTheme, Record<string, LanguageHighlightCssToken>> = {
  light: {
    new: { ink: "#713f12", background: "#fef3c7", decoration: "#a16207", pattern: "dotted" },
    encountered: { ink: "#164e63", background: "#cffafe", decoration: "#0e7490", pattern: "dashed" },
    learning: { ink: "#581c87", background: "#f3e8ff", decoration: "#7e22ce", pattern: "solid" },
    familiar: { ink: "#14532d", background: "#dcfce7", decoration: "#15803d", pattern: "wavy" },
    known: { ink: "inherit", background: "transparent", decoration: "transparent", pattern: "none" },
    ignored: { ink: "#374151", background: "#f3f4f6", decoration: "#4b5563", pattern: "double" },
  },
  dark: {
    new: { ink: "#fef3c7", background: "#713f12", decoration: "#facc15", pattern: "dotted" },
    encountered: { ink: "#cffafe", background: "#164e63", decoration: "#22d3ee", pattern: "dashed" },
    learning: { ink: "#f3e8ff", background: "#581c87", decoration: "#d8b4fe", pattern: "solid" },
    familiar: { ink: "#dcfce7", background: "#14532d", decoration: "#86efac", pattern: "wavy" },
    known: { ink: "inherit", background: "transparent", decoration: "transparent", pattern: "none" },
    ignored: { ink: "#e5e7eb", background: "#374151", decoration: "#9ca3af", pattern: "double" },
  },
  "high-contrast": {
    new: { ink: "#000000", background: "#fff200", decoration: "#000000", pattern: "dotted" },
    encountered: { ink: "#000000", background: "#00ffff", decoration: "#000000", pattern: "dashed" },
    learning: { ink: "#ffffff", background: "#4b0082", decoration: "#ffffff", pattern: "solid" },
    familiar: { ink: "#000000", background: "#7fff00", decoration: "#000000", pattern: "wavy" },
    known: { ink: "inherit", background: "transparent", decoration: "transparent", pattern: "none" },
    ignored: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "double" },
  },
  "e-ink": {
    new: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "dotted" },
    encountered: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "dashed" },
    learning: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "solid" },
    familiar: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "wavy" },
    known: { ink: "inherit", background: "transparent", decoration: "transparent", pattern: "none" },
    ignored: { ink: "#000000", background: "#ffffff", decoration: "#000000", pattern: "double" },
  },
};

export const LANGUAGE_VOCABULARY_CLASS = "language-vocabulary-token";

export function languageVocabularyStateClass(state: string): string {
  return `${LANGUAGE_VOCABULARY_CLASS} language-vocabulary-${state}`;
}

export function languageHighlightCssToken(
  state: string,
  settings: Pick<LanguageHighlightSettings, "theme" | "highContrast" | "eInk" | "reducedMotion">,
): LanguageHighlightCssToken {
  const theme: LanguageHighlightTheme = settings.eInk
    ? "e-ink"
    : settings.highContrast
      ? "high-contrast"
      : settings.theme;
  return TOKENS[theme][state] ?? TOKENS[theme].known;
}

export function languageHighlightCssVariables(
  state: string,
  settings: Pick<LanguageHighlightSettings, "theme" | "highContrast" | "eInk" | "reducedMotion">,
  treatment: VocabularyVisualTreatment,
  cue: VocabularyVisualCue,
): LanguageHighlightCssVariables {
  const token = languageHighlightCssToken(state, settings);
  return {
    "--language-vocabulary-ink": token.ink,
    "--language-vocabulary-background": treatment === "none" ? "transparent" : token.background,
    "--language-vocabulary-decoration": treatment === "none" ? "transparent" : token.decoration,
    "--language-vocabulary-pattern": cue,
  };
}
