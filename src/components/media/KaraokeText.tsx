import React from "react";
import {
  findActiveWordIndex,
  wordTimingsAlignWith,
  type WordTiming,
} from "../../utils/wordTimings";

interface KaraokeTextProps {
  text: string;
  wordTimings?: WordTiming[];
  /** Playback position in seconds. */
  currentTime: number;
  /** Only the active segment highlights — reading ahead shouldn't be a jumble. */
  isActive: boolean;
  /**
   * True when `wordTimings` were estimated rather than measured
   * (see `synthesizeWordTimings`). Renders a softer style so an estimate never
   * masquerades as a measurement.
   */
  approximate?: boolean;
  /**
   * Optional per-token renderer, so callers can layer their own markup (e.g.
   * search-term <mark>s) underneath the karaoke highlight.
   */
  renderToken?: (token: string) => React.ReactNode;
}

const EXACT_CLASS = "font-bold text-primary bg-primary/10 rounded px-0.5";
const APPROXIMATE_CLASS = "text-primary/90 bg-primary/5 rounded px-0.5";

/**
 * Renders transcript text with the currently-spoken word highlighted.
 *
 * Returns a fragment of spans (no wrapper element) so each caller keeps its own
 * typography. Word→text matching is positional: the Nth whitespace token gets
 * the Nth timing. If the counts disagree the timings are ignored entirely —
 * highlighting the wrong word is worse than highlighting none.
 */
export const KaraokeText = React.memo(function KaraokeText({
  text,
  wordTimings,
  currentTime,
  isActive,
  approximate = false,
  renderToken,
}: KaraokeTextProps) {
  const usable = isActive && wordTimingsAlignWith(text, wordTimings);
  if (!usable) {
    return <>{renderToken ? renderToken(text) : text}</>;
  }

  const activeIdx = findActiveWordIndex(wordTimings, currentTime);

  // Split into words *and* whitespace so original spacing survives; the capture
  // group keeps the separators in the array.
  const tokens = text.split(/(\s+)/);
  let wordTokenIdx = -1;
  return (
    <>
      {tokens.map((token, i) => {
        const isWord = token.trim().length > 0;
        if (isWord) wordTokenIdx++;
        const highlight = isWord && wordTokenIdx === activeIdx;
        const content = renderToken ? renderToken(token) : token;
        return (
          <span
            key={i}
            // Stable hook for tests and for anything that needs to locate the
            // spoken word in the DOM.
            data-karaoke-word={highlight ? "active" : undefined}
            className={highlight ? (approximate ? APPROXIMATE_CLASS : EXACT_CLASS) : undefined}
          >
            {content}
          </span>
        );
      })}
    </>
  );
});
