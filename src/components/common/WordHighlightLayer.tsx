import { useEffect, useRef } from "react";
import { WordHighlighter } from "../../utils/wordHighlighter";
import type { TTSChunk } from "../../utils/readerSpeechIndex";

interface WordHighlightLayerProps {
  enabled: boolean;
  /** Anchored chunk (words carry source anchors + section offsets). */
  chunk?: TTSChunk | null;
  /** Legacy flat chunk text (anchor-less callers). */
  chunkText: string;
  wordOffset: number;
  /** Whether the active word's timing is synthesized (approximate). */
  timingApproximate?: boolean;
  /** Container element where text lives (for Markdown/PDF/EPUB) */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Use chunk-level highlighting instead of word-level */
  useChunkLevel?: boolean;
  /** Optional fallback iframe contentWindow */
  iframeWindow?: Window | null;
  /**
   * Section-keyed containers (EPUB iframe bodies per spine section). When the
   * chunk's section maps to a container, highlighting resolves there —
   * duplicate text in other sections can never match.
   */
  sectionContainers?: Map<string, HTMLElement> | null;
}

export function WordHighlightLayer({
  enabled,
  chunk,
  chunkText,
  wordOffset,
  timingApproximate = false,
  containerRef,
  useChunkLevel = false,
  iframeWindow,
  sectionContainers,
}: WordHighlightLayerProps) {
  // Track highlighters mapped by their HTML container elements to avoid leaks and memory issues
  const highlightersRef = useRef<Map<HTMLElement, WordHighlighter>>(new Map());

  // Clean up all highlighters on unmount
  useEffect(() => {
    return () => {
      highlightersRef.current.forEach((hl) => hl.destroy());
      highlightersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      highlightersRef.current.forEach((hl) => hl.clear());
      return;
    }

    // 1. Gather all active containers (both the main container and any embedded iframes)
    const targets: HTMLElement[] = [];
    const targetsById = new Map<string, HTMLElement>();

    if (iframeWindow && iframeWindow.document?.body) {
      targets.push(iframeWindow.document.body);
      targetsById.set(`body:${iframeWindow.document.body}`, iframeWindow.document.body);
    }

    let mainContainer = containerRef?.current;
    if (!mainContainer && typeof document !== "undefined") {
      mainContainer = (document.querySelector("[data-document-scroll-container]") ||
                      document.querySelector(".viewer-content-area")) as HTMLElement | null;
    }

    if (mainContainer) {
      // Find all iframe bodies (important for EPUB continuous scroll/chapters)
      const iframes = Array.from(mainContainer.querySelectorAll("iframe"));
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc && iframeDoc.body) {
            if (!targets.includes(iframeDoc.body)) {
              targets.push(iframeDoc.body);
            }
          }
        } catch {
          // Ignore cross-origin access security warnings
        }
      }

      // If no iframes are rendered, fall back to the main container itself
      if (targets.length === 0) {
        targets.push(mainContainer);
      }
    }

    const currentHighlighters = highlightersRef.current;

    // 2. Synchronize highlighters map with targets
    for (const [el, hl] of currentHighlighters.entries()) {
      if (!targets.includes(el)) {
        hl.destroy();
        currentHighlighters.delete(el);
      }
    }

    for (const el of targets) {
      let hl = currentHighlighters.get(el);
      if (!hl) {
        hl = new WordHighlighter();
        hl.init(el, useChunkLevel);
        currentHighlighters.set(el, hl);
      }
      hl.setEnabled(true);
      hl.clear();
    }

    // 3. Apply the highlight. With an anchored chunk, resolve the owning
    //    container via the section map first (exact occurrence); all other
    //    instances stay cleared. Falls back to the legacy constrained match.
    const sectionKey = chunk?.sectionKey;
    const owningContainer =
      sectionKey && sectionContainers ? sectionContainers.get(sectionKey) ?? null : null;

    if (sectionContainers) {
      // Section routing is authoritative when provided (EPUB): only the
      // owning section's instance highlights, never a duplicate-text sibling.
      if (owningContainer && currentHighlighters.has(owningContainer)) {
        const hl = currentHighlighters.get(owningContainer)!;
        if (chunk && !useChunkLevel) {
          hl.highlightAnchoredWord(chunk, wordOffset, timingApproximate);
        } else {
          hl.highlightChunk(chunk?.text ?? chunkText);
        }
      }
      return;
    }

    for (const hl of currentHighlighters.values()) {
      if (chunk && !useChunkLevel && hl.highlightAnchoredWord(chunk, wordOffset, timingApproximate)) {
        continue;
      }
      if (useChunkLevel) {
        hl.highlightChunk(chunk?.text ?? chunkText);
      } else {
        hl.highlightWord(chunk?.text ?? chunkText, wordOffset);
      }
    }
  }, [
    enabled,
    chunk,
    chunkText,
    wordOffset,
    timingApproximate,
    useChunkLevel,
    containerRef,
    containerRef?.current,
    iframeWindow,
    sectionContainers,
  ]);

  return null;
}
