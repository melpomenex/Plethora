/**
 * Ask Plethora region: heading + helper + See examples, and the reference
 * 2×2 suggestion grid. "See examples" expands a bounded extra example
 * catalogue inside the palette; selecting any library suggestion routes
 * through the hub (handoff / search / review) without starting a request.
 */

import {
  ArrowRight,
  Cards,
  FileText,
  MagnifyingGlass,
  Sparkle,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { PaletteSuggestion } from "../../../commandPalette/types";

function SuggestionIcon({ suggestion }: { suggestion: PaletteSuggestion }) {
  switch (suggestion.icon) {
    case "fileText":
      return <FileText className="ch-suggestion-glyph" aria-hidden="true" />;
    case "magnifyingGlass":
      return <MagnifyingGlass className="ch-suggestion-glyph" aria-hidden="true" />;
    case "cards":
      return <Cards className="ch-suggestion-glyph" aria-hidden="true" />;
    default:
      return (
        <Sparkle className="ch-suggestion-glyph" weight="fill" aria-hidden="true" />
      );
  }
}

export interface PaletteSuggestionsProps {
  suggestions: PaletteSuggestion[];
  expandedExamples: PaletteSuggestion[];
  examplesOpen: boolean;
  onToggleExamples: () => void;
  onSuggestion: (suggestion: PaletteSuggestion) => void;
}

export function PaletteSuggestions({
  suggestions,
  expandedExamples,
  examplesOpen,
  onToggleExamples,
  onSuggestion,
}: PaletteSuggestionsProps) {
  const { t } = useI18n();

  return (
    <section className="ch-section" aria-label={t("palette.askSection")}>
      <div className="ch-section-head ch-section-head--ask">
        <h3 className="ch-section-title">
          <Cards className="ch-section-glyph" weight="fill" aria-hidden="true" />
          {t("palette.askSection")}
        </h3>
        <span className="ch-ask-helper">{t("palette.askHelper")}</span>
        <button
          type="button"
          className="ch-link"
          aria-expanded={examplesOpen}
          onClick={onToggleExamples}
        >
          {t("palette.seeExamples")}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="ch-suggestions">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="ch-suggestion"
            onClick={() => onSuggestion(suggestion)}
          >
            <SuggestionIcon suggestion={suggestion} />
            <span className="ch-suggestion-label">{suggestion.label}</span>
            <ArrowRight className="ch-suggestion-arrow" aria-hidden="true" />
          </button>
        ))}
      </div>

      {examplesOpen && expandedExamples.length > 0 && (
        <div className="ch-examples" aria-label={t("palette.examplesLabel")}>
          {expandedExamples.map((example) => (
            <button
              key={example.id}
              type="button"
              className="ch-suggestion ch-suggestion--example"
              onClick={() => onSuggestion(example)}
            >
              <SuggestionIcon suggestion={example} />
              <span className="ch-suggestion-label">{example.label}</span>
              <ArrowRight className="ch-suggestion-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
