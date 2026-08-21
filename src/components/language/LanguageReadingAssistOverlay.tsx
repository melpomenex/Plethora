import { useEffect, useMemo, useState } from "react";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, type LanguageHostActionDetail } from "../../lib/languageHost";
import { ReadingAssistRegistry } from "../../lib/languageReadingAssist";

/** Source-preserving reading-assist surface with truthful unsupported states. */
export function LanguageReadingAssistOverlay() {
  const { snapshot } = useLanguageLearningHost();
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const registry = useMemo(() => new ReadingAssistRegistry(), []);
  const [status, setStatus] = useState<"pending" | "ready" | "unsupported" | "failed">("pending");

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
    void registry.run({
      sourceId: request.source.contentId,
      contentFingerprint: request.source.contentFingerprint ?? request.source.source.contentFingerprint ?? "-",
      text: request.selectedText ?? request.source.text ?? "",
      languageTag: snapshot.profile.targetLanguage,
      profileId: snapshot.profile.id,
      kind: "gloss",
    }).then((result) => {
      if (disposed) return;
      setStatus(result.status === "ready" ? "ready" : result.status === "unsupported" ? "unsupported" : "failed");
    }).catch(() => { if (!disposed) setStatus("failed"); });
    return () => { disposed = true; };
  }, [registry, request, snapshot.profile, snapshot.status]);

  if (!request || snapshot.status !== "ready") return null;
  return (
    <div className="fixed inset-x-4 bottom-20 z-[75] mx-auto max-w-lg rounded-xl border border-border bg-card p-3 text-sm shadow-xl" role="status" data-language-reading-assist="true">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Reading assist</p>
          <p className="mt-1 text-xs text-muted-foreground">{status === "pending" ? "Checking available source-preserving assistance…" : status === "ready" ? "Assistance ready; source text remains unchanged." : "No compatible offline reading-assist provider is configured for this language."}</p>
        </div>
        <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => setRequest(null)}>Close</button>
      </div>
    </div>
  );
}
