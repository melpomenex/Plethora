import { useEffect } from "react";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import { useOptionalLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { applyLanguageAnnotationSpans, buildVocabularyAnnotations, clearLanguageAnnotationSpans, loadLanguageHighlightSettings, normalizeLanguageHighlightSettings } from "../../lib/languageHighlighting";
import { DomLanguageHighlightAdapter } from "../../lib/languageHighlighting/adapters";
import { anchorConfidence, tokenizeLanguageText } from "../../lib/languageHighlighting/adapters/tokenizer";
import { isLanguageKnowledgeState } from "../../lib/languageHighlighting/state";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { TranscriptSegment } from "../media/TranscriptSync";

export interface LanguageTranscriptDomBridgeProps {
  container: HTMLElement | null;
  segments: readonly TranscriptSegment[];
  sourceId: string;
}

/** Vocabulary overlays for transcript segment text without owning playback. */
export function LanguageTranscriptDomBridge({ container, segments, sourceId }: LanguageTranscriptDomBridgeProps) {
  const host = useOptionalLanguageLearningHost();
  if (!host) return null;
  const { snapshot } = host;

  useEffect(() => {
    let disposed = false;
    if (!container || snapshot.status !== "ready" || !snapshot.profile) return;
    const profile = snapshot.profile;
    const segmentRoots = Array.from(container.querySelectorAll<HTMLElement>("[data-language-transcript-segment]"));
    if (segmentRoots.length === 0) return;

    const settings = normalizeLanguageHighlightSettings(profile.id, {
      ...loadLanguageHighlightSettings(profile.id, typeof window === "undefined" ? undefined : window.localStorage),
      mode: "full",
    });

    void listLanguageLexicalEntries(profile.id, { languageTag: profile.targetLanguage, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const entries = new Map(page.items.map((entry) => [entry.normalizedForm, entry]));
        const states = new Map<string, LanguageKnowledgeState>();
        for (const entry of page.items) {
          if (isLanguageKnowledgeState(entry.knowledgeState)) states.set(entry.id, entry.knowledgeState);
        }
        const stateMap = { profileId: profile.id, lexicalStateVersion: 1, states };

        for (const root of segmentRoots) {
          const segmentId = root.getAttribute("data-language-transcript-segment") ?? "";
          const segment = segments.find((value) => value.id === segmentId);
          if (!segment) continue;
          const adapter = new DomLanguageHighlightAdapter("transcript", sourceId, root, (node, start, end) => ({
            kind: "dom-text",
            sourceId,
            node,
            startOffset: start,
            endOffset: end,
            confidence: anchorConfidence(1),
            confidenceScore: 1,
          }));
          const anchors = adapter.getTokenAnchors();
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
          const annotations = buildVocabularyAnnotations({
            tokens,
            stateMap,
            settings,
            expectedVersions: { analysisVersion: 1, lexicalStateVersion: 1 },
          });
          applyLanguageAnnotationSpans(root, annotations, settings);
          adapter.dispose();
        }
      })
      .catch(() => {
        if (!disposed) {
          for (const root of segmentRoots) clearLanguageAnnotationSpans(root);
        }
      });

    return () => {
      disposed = true;
      for (const root of segmentRoots) clearLanguageAnnotationSpans(root);
    };
  }, [container, segments, snapshot.profile, snapshot.status, sourceId]);

  return null;
}

export function tokenizeTranscriptSegmentText(text: string): ReturnType<typeof tokenizeLanguageText> {
  return tokenizeLanguageText(text);
}
