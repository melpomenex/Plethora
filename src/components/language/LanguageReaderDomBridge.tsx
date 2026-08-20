import { useEffect } from "react";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { applyLanguageAnnotationSpans, clearLanguageAnnotationSpans, buildVocabularyAnnotations, loadLanguageHighlightSettings, normalizeLanguageHighlightSettings } from "../../lib/languageHighlighting";
import { DomLanguageHighlightAdapter, EpubLanguageHighlightAdapter, HtmlLanguageHighlightAdapter, MarkdownLanguageHighlightAdapter } from "../../lib/languageHighlighting/adapters";
import type { LanguageHighlightReaderAdapter } from "../../lib/languageHighlighting/adapters";
import { anchorConfidence, tokenizeLanguageText } from "../../lib/languageHighlighting/adapters/tokenizer";
import { isLanguageKnowledgeState } from "../../lib/languageHighlighting/state";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { PdfCanonicalPage } from "../../types/pdfCanonical";
import type { LanguageHighlightAnchor, ReaderTokenAnchor } from "../../lib/languageHighlighting/types";

type ReaderDomSurface = "epub" | "html" | "markdown" | "plain-text" | "pdf-reflow" | "pdf-fixed";

export interface LanguageReaderDomBridgeProps {
  root: ParentNode | null;
  surface: ReaderDomSurface;
  sourceId: string;
  contentSelector?: string;
  pdfTextLayerRoots?: readonly (HTMLDivElement | null)[];
  pdfCanonicalPages?: ReadonlyMap<number, PdfCanonicalPage>;
}

function textNodes(root: ParentNode): Text[] {
  const ownerDocument = root.nodeType === 9 ? root as Document : root.ownerDocument;
  if (!ownerDocument) return [];
  const walker = ownerDocument.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node instanceof Text && node.data.trim()) nodes.push(node);
  }
  return nodes;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function fixedPdfAnchors(
  roots: readonly (HTMLDivElement | null)[],
  pages: ReadonlyMap<number, PdfCanonicalPage>,
  sourceId: string,
): ReaderTokenAnchor[] {
  const anchors: ReaderTokenAnchor[] = [];
  roots.forEach((root, index) => {
    if (!root) return;
    const words = pages.get(index + 1)?.words ?? [];
    const domTokens = textNodes(root).flatMap((node) =>
      tokenizeLanguageText(node.data).map((token) => ({ node, ...token })),
    );
    const count = Math.min(words.length, domTokens.length);
    for (let wordIndex = 0; wordIndex < count; wordIndex += 1) {
      const word = words[wordIndex];
      const domToken = domTokens[wordIndex];
      if (normalized(word.text) !== normalized(domToken.text)) continue;
      const anchor: LanguageHighlightAnchor = {
        kind: "pdf-canonical-word",
        sourceId,
        pageNumber: word.pageNumber,
        wordId: word.id,
        source: word.source,
        bboxExact: word.bboxExact,
        confidence: anchorConfidence(word.confidence),
        confidenceScore: word.confidence,
        node: domToken.node,
        startOffset: domToken.start,
        endOffset: domToken.end,
      };
      anchors.push({
        id: `${sourceId}:fixed:${word.id}`,
        sourceId,
        surface: domToken.text,
        range: { start: anchors.length, end: anchors.length + 1 },
        anchor,
      });
    }
  });
  return anchors;
}

/** Mounts the existing read-only adapters into HTML/Markdown/EPUB content. */
export function LanguageReaderDomBridge({ root, surface, sourceId, contentSelector, pdfTextLayerRoots = [], pdfCanonicalPages = new Map() }: LanguageReaderDomBridgeProps) {
  const { snapshot } = useLanguageLearningHost();

  useEffect(() => {
    let disposed = false;
    const contentRoot = contentSelector && root && "querySelector" in root
      ? root.querySelector(contentSelector)
      : root;
    if (snapshot.status !== "ready" || !snapshot.profile) return;
    if (surface !== "pdf-fixed" && !contentRoot) return;

    const profile = snapshot.profile;
    const adapter: LanguageHighlightReaderAdapter | null = surface === "pdf-fixed"
      ? null
      : surface === "epub"
      ? new EpubLanguageHighlightAdapter(contentRoot as never, sourceId)
      : surface === "html"
        ? new HtmlLanguageHighlightAdapter(contentRoot as never, sourceId)
        : surface === "pdf-reflow"
          ? new DomLanguageHighlightAdapter("pdf-reflow", sourceId, contentRoot as never, (node, start, end) => {
              const block = node.parentElement?.closest("[data-pdf-confidence]");
              const confidence = Number(block?.getAttribute("data-pdf-confidence") ?? 1);
              return {
                kind: "dom-text",
                sourceId,
                node,
                startOffset: start,
                endOffset: end,
                confidence: anchorConfidence(confidence),
                confidenceScore: confidence,
              };
            })
          : new MarkdownLanguageHighlightAdapter(contentRoot as never, sourceId);
    const settingsFromStorage = loadLanguageHighlightSettings(
      profile.id,
      typeof window === "undefined" ? undefined : window.localStorage,
    );
    const settings = normalizeLanguageHighlightSettings(profile.id, {
      ...settingsFromStorage,
      mode: settingsFromStorage.mode === "off" ? "full" : settingsFromStorage.mode,
    });
    const anchors = surface === "pdf-fixed"
      ? fixedPdfAnchors(pdfTextLayerRoots, pdfCanonicalPages, sourceId)
      : adapter?.getTokenAnchors() ?? [];

    void listLanguageLexicalEntries(profile.id, { languageTag: profile.targetLanguage, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const entries = new Map(page.items.map((entry) => [entry.normalizedForm, entry]));
        const tokens = anchors.flatMap((anchor) => {
          const entry = entries.get(anchor.surface.normalize("NFKC").toLocaleLowerCase());
          if (!entry) return [];
          return [{
            id: anchor.id,
            profileId: profile.id,
            lexicalEntryId: entry.id,
            surface: anchor.surface,
            normalized: entry.normalizedForm,
            sourceId: anchor.sourceId,
            range: anchor.range,
            anchor: anchor.anchor,
            analysisVersion: 1,
            analysisAvailable: true,
          }];
        });
        const states = new Map<string, LanguageKnowledgeState>();
        for (const entry of page.items) {
          if (isLanguageKnowledgeState(entry.knowledgeState)) states.set(entry.id, entry.knowledgeState);
        }
        const stateMap = {
          profileId: profile.id,
          lexicalStateVersion: 1,
          states,
        };
        const annotations = buildVocabularyAnnotations({
          tokens,
          stateMap,
          settings,
          expectedVersions: { analysisVersion: 1, lexicalStateVersion: 1 },
        });
        applyLanguageAnnotationSpans(contentRoot, annotations, settings);
      })
      .catch(() => {
        // A missing lexicon projection must not block ordinary reading.
        if (!disposed) clearLanguageAnnotationSpans(contentRoot);
      });

    return () => {
      disposed = true;
      clearLanguageAnnotationSpans(contentRoot);
      adapter?.dispose();
    };
  }, [contentSelector, pdfCanonicalPages, pdfTextLayerRoots, root, snapshot.profile, snapshot.status, sourceId, surface]);

  return null;
}
