import { useEffect, useMemo, useState } from "react";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import { createProductionReadingAssistRegistry } from "../../lib/languageReadingAssist/productionRegistry";
import type { ReadingAssistResult } from "../../lib/languageReadingAssist/types";
import { applyReadingAssistSpans, clearReadingAssistSpans, readingAssistStyleText } from "../../lib/languageReadingAssist/domDecoration";

function collectReadingAssistRoots(): ParentNode[] {
  const roots = new Set<ParentNode>();
  document.querySelectorAll("[data-language-content-root]").forEach((node) => roots.add(node));
  document.querySelectorAll("[data-transcript-scroll]").forEach((node) => roots.add(node));
  document.querySelectorAll("[data-x-thread-viewer]").forEach((node) => roots.add(node));
  document.querySelectorAll("iframe").forEach((iframe) => {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc?.body) roots.add(doc.body);
    } catch {
      // Cross-origin frames cannot be decorated.
    }
  });
  return Array.from(roots);
}

/** Source-preserving reading-assist surface with truthful unsupported states. */
export function LanguageReadingAssistOverlay() {
  const { snapshot, readingAssistRegistry } = useLanguageLearningHost();
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const registry = readingAssistRegistry ?? createProductionReadingAssistRegistry();
  const [status, setStatus] = useState<"pending" | "ready" | "unsupported" | "failed">("pending");
  const [assistResult, setAssistResult] = useState<ReadingAssistResult | null>(null);
  const passage = useMemo(
    () => request?.selectedText?.trim() || request?.source.text?.trim() || "",
    [request],
  );

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (detail?.hostId === snapshot.hostId && detail.action === "reading-assist") setRequest(detail);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId]);

  useEffect(() => {
    let disposed = false;
    if (!request || snapshot.status !== "ready" || !snapshot.profile) return () => { disposed = true; };
    setStatus("pending");
    setAssistResult(null);
    void registry.run({
      sourceId: request.source.contentId,
      contentFingerprint: request.source.contentFingerprint ?? request.source.source.contentFingerprint ?? "-",
      text: passage,
      languageTag: snapshot.profile.targetLanguage,
      profileId: snapshot.profile.id,
      kind: "gloss",
    }).then((result) => {
      if (disposed) return;
      setStatus(result.status === "ready" ? "ready" : result.status === "unsupported" ? "unsupported" : "failed");
      setAssistResult(result.status === "ready" ? result : null);
    }).catch(() => { if (!disposed) { setStatus("failed"); setAssistResult(null); } });
    return () => { disposed = true; };
  }, [passage, registry, request, snapshot.profile, snapshot.status]);

  useEffect(() => {
    if (status !== "ready" || !assistResult?.spans.length || !passage) return;
    const roots = collectReadingAssistRoots();
    for (const root of roots) applyReadingAssistSpans(root, passage, assistResult.spans);
    return () => {
      for (const root of roots) clearReadingAssistSpans(root);
    };
  }, [assistResult, passage, status]);

  const close = () => {
    for (const root of collectReadingAssistRoots()) clearReadingAssistSpans(root);
    setAssistResult(null);
    setRequest(null);
  };

  if (!request || snapshot.status !== "ready") return null;
  return (
    <>
      <style data-language-reading-assist-style>{readingAssistStyleText()}</style>
      <div className="fixed inset-x-4 bottom-20 z-[75] mx-auto max-w-lg rounded-xl border border-border bg-card p-3 text-sm shadow-xl" role="status" data-language-reading-assist="true">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Reading assist</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {status === "pending"
                ? "Checking available source-preserving assistance…"
                : status === "ready"
                  ? assistResult?.spans.length
                    ? `Applied ${assistResult.spans.length} gloss${assistResult.spans.length === 1 ? "" : "es"} in the document.`
                    : "Assistance ready; source text remains unchanged."
                  : snapshot.capabilities.readingAssist.detail ?? "No compatible reading-assist provider is configured for this language."}
            </p>
            {status === "ready" && assistResult?.spans.length ? (
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">
                {assistResult.spans.map((span) => (
                  <li key={span.id}>
                    <span className="font-medium">{span.sourceText}</span>
                    {span.annotation || span.renderedText ? (
                      <span className="text-muted-foreground"> — {span.annotation ?? span.renderedText}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={close}>Close</button>
        </div>
      </div>
    </>
  );
}
