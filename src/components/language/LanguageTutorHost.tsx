import { useEffect, useState } from "react";
import { TutorSheet } from "../tutor/TutorSheet";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { dispatchLanguageHostAction, LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import { buildLearnerContext, type ContextLexiconRow, type TutorMode } from "../../lib/languageTutor";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

/** Opens the existing bounded TutorSheet from reader/video/peek action events. */
export function LanguageTutorHost() {
  const { snapshot } = useLanguageLearningHost();
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [context, setContext] = useState<ReturnType<typeof buildLearnerContext> | null>(null);
  const [mode, setMode] = useState<TutorMode>("explain");
  const [contextStatus, setContextStatus] = useState<"idle" | "loading" | "ready" | "stale" | "failed">("idle");

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (detail?.hostId === snapshot.hostId && detail.action === "tutor") {
        setRequest(detail);
        setMode("explain");
      }
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  useEffect(() => {
    let disposed = false;
    if (!request || snapshot.status !== "ready" || !snapshot.profile) {
      setContext(null);
      setContextStatus("idle");
      return () => { disposed = true; };
    }
    if (request.source.contentId !== snapshot.source.contentId || (request.source.contentFingerprint && snapshot.source.contentFingerprint && request.source.contentFingerprint !== snapshot.source.contentFingerprint)) {
      setContext(null);
      setContextStatus("stale");
      return () => { disposed = true; };
    }
    setContextStatus("loading");
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
        setContextStatus("ready");
      })
      .catch(() => { if (!disposed) { setContext(null); setContextStatus("failed"); } });
    return () => { disposed = true; };
  }, [request, snapshot.profile, snapshot.status]);

  if (!request || snapshot.status !== "ready" || !snapshot.profile) return null;
  if (contextStatus === "stale") {
    return (
      <div className="fixed inset-x-4 bottom-20 z-[75] mx-auto max-w-lg rounded-xl border border-amber-500/40 bg-card p-3 text-sm shadow-xl" role="alert">
        <p className="font-medium">Tutor source changed</p>
        <p className="mt-1 text-xs text-muted-foreground">This explanation was selected from an older source fingerprint. Refresh it before asking a source-grounded question.</p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setRequest(null)}>Close</button>
          <button type="button" className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground" onClick={() => setRequest((previous) => previous ? { ...previous, source: snapshot.source, sourceAnchor: snapshot.source.source } : previous)}>Refresh source</button>
        </div>
      </div>
    );
  }
  return (
    <TutorSheet
      open
      material={request.selectedText ?? request.source.text ?? ""}
      documentId={request.source.contentId}
      languageContext={context ?? undefined}
      languageMode={mode}
      onLanguageModeChange={setMode}
      onWritingPractice={(text) => dispatchLanguageHostAction({ action: "practice", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile.id, languageTag: snapshot.profile.targetLanguage, practiceMode: "writing", origin: "tutor" })}
      selectionContext={request.sourceAnchor}
      onClose={() => setRequest(null)}
    />
  );
}
