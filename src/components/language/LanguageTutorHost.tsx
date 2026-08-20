import { useEffect, useState } from "react";
import { TutorSheet } from "../tutor/TutorSheet";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import { buildLearnerContext, type ContextLexiconRow } from "../../lib/languageTutor";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

/** Opens the existing bounded TutorSheet from reader/video/peek action events. */
export function LanguageTutorHost() {
  const { snapshot } = useLanguageLearningHost();
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [context, setContext] = useState<ReturnType<typeof buildLearnerContext> | null>(null);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (detail?.hostId === snapshot.hostId && detail.action === "tutor") setRequest(detail);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  useEffect(() => {
    let disposed = false;
    if (!request || snapshot.status !== "ready" || !snapshot.profile) {
      setContext(null);
      return () => { disposed = true; };
    }
    void listLanguageLexicalEntries(snapshot.profile.id, { languageTag: snapshot.profile.targetLanguage, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const lexicon: ContextLexiconRow[] = page.items.flatMap((entry) => {
          const state = entry.knowledgeState;
          if (state !== "new" && state !== "encountered" && state !== "learning" && state !== "familiar" && state !== "known" && state !== "ignored") return [];
          return [{ entryId: entry.id, surface: entry.canonicalForm || entry.normalizedForm, lemma: entry.lemma, state: state as LanguageKnowledgeState, evidenceCount: entry.activeEvidenceCount + entry.passiveEvidenceCount }];
        });
        setContext(buildLearnerContext({
          profile: { id: snapshot.profile!.id, targetLanguage: snapshot.profile!.targetLanguage, baseLanguage: snapshot.profile!.baseLanguage },
          lexicon,
          currentSource: request.source.text ? { documentId: request.source.contentId, text: request.source.text } : undefined,
          budget: { maxItems: 24, maxTextCodeUnits: 1200, includeSourceText: false },
        }));
      })
      .catch(() => { if (!disposed) setContext(null); });
    return () => { disposed = true; };
  }, [request, snapshot.profile, snapshot.status]);

  if (!request || snapshot.status !== "ready" || !snapshot.profile) return null;
  return (
    <TutorSheet
      open
      material={request.selectedText ?? request.source.text ?? ""}
      documentId={request.source.contentId}
      languageContext={context ?? undefined}
      languageMode="explain"
      selectionContext={request.sourceAnchor}
      onClose={() => setRequest(null)}
    />
  );
}
