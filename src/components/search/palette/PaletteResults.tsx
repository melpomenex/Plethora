/**
 * Search-result presentation for the hub.
 *
 * Valid combobox/listbox semantics: the input owns keyboard selection via
 * `aria-activedescendant`; every option is exactly one action. Secondary
 * content matches are exposed in a separate detail region below the list so
 * no interactive control is nested inside an option, and activating a
 * secondary hit targets only that hit.
 */

import { MagnifyingGlass } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { SearchHit } from "../../../types/searchHit";
import type { SearchResult } from "../GlobalSearch";

export interface PaletteResultsProps {
  results: SearchResult[];
  selectedIndex: number;
  isSearching: boolean;
  onSelect: (index: number) => void;
  onActivate: (result: SearchResult, hit?: SearchHit) => void;
  listboxId: string;
  emptyState: React.ReactNode;
}

export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function ResultGlyph({ result }: { result: SearchResult }) {
  if (result.metadata?.figureUrl) {
    return (
      <img
        src={result.metadata.figureUrl}
        alt=""
        className="ch-result-thumb"
      />
    );
  }
  const tone =
    result.type === "document"
      ? "ch-result-icon--document"
      : result.type === "extract"
        ? "ch-result-icon--extract"
        : result.type === "flashcard"
          ? "ch-result-icon--card"
          : result.type === "media"
            ? "ch-result-icon--media"
            : "ch-result-icon--generic";
  return (
    <span className={`ch-result-icon ${tone}`} aria-hidden="true">
      {result.type[0]?.toUpperCase()}
    </span>
  );
}

export function PaletteResults({
  results,
  selectedIndex,
  isSearching,
  onSelect,
  onActivate,
  listboxId,
  emptyState,
}: PaletteResultsProps) {
  const { t } = useI18n();

  if (isSearching && results.length === 0) {
    return (
      <div className="ch-empty" aria-busy="true">
        <span className="ch-empty-spinner" aria-hidden="true" />
        <p className="ch-empty-title">{t("palette.searching")}</p>
      </div>
    );
  }

  if (!isSearching && results.length === 0) {
    return <>{emptyState}</>;
  }

  const selected = results[selectedIndex];
  const secondaryHits = selected?.metadata?.secondaryHits ?? [];

  return (
    <div className="ch-results-wrap">
      <div
        className="ch-results"
        role="listbox"
        id={listboxId}
        aria-label={t("palette.resultsLabel")}
      >
        {results.map((result, index) => {
          const prevGroup =
            index > 0 ? results[index - 1]?.metadata?.groupLabel : undefined;
          const showGroupHeader =
            Boolean(result.metadata?.groupLabel) &&
            result.metadata?.groupLabel !== prevGroup;
          const isSelected = index === selectedIndex;
          return (
            <div key={result.id}>
              {showGroupHeader && (
                <div className="ch-group" role="presentation">
                  {result.metadata?.groupLabel}
                </div>
              )}
              <div
                id={optionId(listboxId, index)}
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected || undefined}
                className={`ch-result${isSelected ? " ch-result--selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onSelect(index)}
                onClick={() => onActivate(result)}
              >
                <ResultGlyph result={result} />
                <div className="ch-result-body">
                  <p className="ch-result-title">
                    <span className="ch-result-title-text">{result.title}</span>
                    {result.highlights && result.highlights.length > 0 && (
                      <span className="ch-result-count">
                        {t("palette.matchCount", { count: result.highlights.length })}
                      </span>
                    )}
                  </p>
                  {result.excerpt && (
                    <p
                      className="ch-result-excerpt"
                      dangerouslySetInnerHTML={{ __html: result.excerpt }}
                    />
                  )}
                  <div className="ch-result-meta">
                    {result.metadata?.shortcut && (
                      <kbd className="ch-kbd">{result.metadata.shortcut}</kbd>
                    )}
                    {result.metadata?.transcriptMatch && (
                      <span className="ch-result-tag">{t("palette.transcript")}</span>
                    )}
                    {result.metadata?.category && (
                      <span className="ch-result-tag">{result.metadata.category}</span>
                    )}
                    {result.metadata?.tags?.slice(0, 2).map((tag) => (
                      <span key={tag} className="ch-result-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {secondaryHits.length > 0 && (
        <div className="ch-detail" role="group" aria-label={t("palette.moreMatches")}>
          <p className="ch-detail-title">{t("palette.moreMatches")}</p>
          <div className="ch-detail-hits">
            {secondaryHits.slice(0, 5).map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="ch-detail-hit"
                onClick={() => selected && onActivate(selected, hit)}
              >
                {hit.label && <span className="ch-detail-label">{hit.label}</span>}
                {hit.excerptHtml ? (
                  <span
                    className="ch-detail-excerpt"
                    dangerouslySetInnerHTML={{ __html: hit.excerptHtml }}
                  />
                ) : (
                  <span className="ch-detail-excerpt">
                    {t("palette.jumpToMatch")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared empty state used when a search settles with no matches. */
export function PaletteNoResults({ query }: { query: string }) {
  const { t } = useI18n();
  return (
    <div className="ch-empty">
      <MagnifyingGlass className="ch-empty-glyph" aria-hidden="true" />
      <p className="ch-empty-title">{t("palette.noResults")}</p>
      <p className="ch-empty-hint">{t("palette.noResultsHint", { query })}</p>
    </div>
  );
}
