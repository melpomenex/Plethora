import { useCallback, useEffect, useRef, useState } from "react";
import { useLibraryAskHandoffStore } from "../../commandPalette/libraryAskHandoff";
import { useDocumentQAStore } from "../../stores/documentQAStore";
import { useI18n } from "../../lib/i18n";
import {
  createSession, loadSessions, migrateLegacyState,
  saveSessions, setActiveSessionId, updateSession,
  type DocumentQaSession, type DocumentQaDraft,
} from "./documentQaSessions";

export interface QaWorkspaceSnapshot {
  messages: DocumentQaSession["messages"];
  selectedDocumentId: string;
  webSearchEnabled: boolean;
  documentName?: string;
  draft: DocumentQaDraft;
}

/** Single owner for Q&A session transitions and acknowledged palette entry. */
export function useDocumentQaWorkspace({ snapshot, restore, isActive, isProcessing, focus }: {
  snapshot: QaWorkspaceSnapshot;
  restore: (session: DocumentQaSession) => void;
  isActive: boolean;
  isProcessing: boolean;
  focus: () => void;
}) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DocumentQaSession[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryAttempt, setEntryAttempt] = useState(0);
  const pending = useLibraryAskHandoffStore((state) => state.pending);
  const latest = useRef({ snapshot, restore, focus, isProcessing });
  latest.current = { snapshot, restore, focus, isProcessing };
  const activeRef = useRef<string | null>(null);
  const hydrated = useRef(false);

  const refresh = useCallback(() => setSessions(loadSessions()), []);
  const reportSaveError = useCallback(() => { setError(t("qaWorkspace.saveError")); return false; }, [t]);

  const flush = useCallback(() => {
    if (!activeRef.current || !hydrated.current) return true;
    const current = latest.current.snapshot;
    // Generation writes to the store before React has committed its render.
    const messages = useDocumentQAStore.getState().messages;
    if (!updateSession(activeRef.current, { ...current, messages, documentName: messages.length ? current.documentName : undefined })) return reportSaveError();
    setError(null);
    refresh();
    return true;
  }, [refresh, reportSaveError]);

  const activate = useCallback((session: DocumentQaSession) => {
    try {
      setActiveSessionId(session.id);
    } catch {
      return reportSaveError();
    }
    activeRef.current = session.id;
    latest.current.snapshot = { ...session, draft: session.draft ?? { text: "", sections: [] } };
    latest.current.restore(session);
    setActiveId(session.id);
    refresh();
    latest.current.focus();
    return true;
  }, [refresh, reportSaveError]);

  useEffect(() => {
    const id = migrateLegacyState();
    const session = loadSessions().find((candidate) => candidate.id === id);
    if (session) {
      activeRef.current = session.id;
      latest.current.snapshot = { ...session, draft: session.draft ?? { text: "", sections: [] } };
      latest.current.restore(session);
      setActiveId(session.id);
    }
    hydrated.current = true;
    setReady(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ready || !isActive) return;
    const timer = window.setTimeout(flush, 500);
    return () => window.clearTimeout(timer);
  }, [ready, isActive, snapshot.messages, snapshot.selectedDocumentId, snapshot.webSearchEnabled,
    snapshot.draft, flush]);

  // A reload/navigation must not lose the last debounce interval of typing.
  useEffect(() => {
    const save = () => { flush(); };
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, [flush]);

  const create = useCallback((partial: Partial<DocumentQaSession> = {}) => {
    if (latest.current.isProcessing || !flush()) return false;
    const session = createSession(partial);
    if (!saveSessions([session, ...loadSessions()])) return reportSaveError();
    return activate(session);
  }, [activate, flush, reportSaveError]);

  const resume = useCallback((id: string) => {
    if (latest.current.isProcessing || id === activeRef.current) return;
    const target = loadSessions().find((session) => session.id === id);
    if (target && flush()) activate(target);
  }, [activate, flush]);

  const rename = useCallback((id: string, title: string) => {
    if (!title.trim()) return;
    if (!updateSession(id, { title: title.trim() })) { reportSaveError(); return; }
    refresh();
  }, [refresh, reportSaveError]);

  const remove = useCallback((id: string) => {
    if (latest.current.isProcessing || !flush()) return;
    let next = loadSessions().filter((session) => session.id !== id);
    const replacement = id === activeRef.current ? createSession() : null;
    if (replacement) next = [replacement, ...next];
    if (!saveSessions(next)) { reportSaveError(); return; }
    if (replacement) activate(replacement);
    refresh();
  }, [activate, flush, refresh, reportSaveError]);

  useEffect(() => {
    if (!pending || !ready || !isActive || isProcessing) return;
    const current = latest.current.snapshot;
    const documentId = pending.documentId ?? "";
    const reusable = current.messages.length === 0 && !current.draft.text.trim()
      && current.selectedDocumentId === documentId && !current.webSearchEnabled;
    if (!flush()) return;
    const session = reusable
      ? loadSessions().find((candidate) => candidate.id === activeRef.current)
      : createSession({ selectedDocumentId: documentId });
    if (!session) return;
    const prepared = { ...session, draft: { text: pending.question, sections: [], contextPassage: pending.contextPassage } };
    const next = [prepared, ...loadSessions().filter((candidate) => candidate.id !== prepared.id)];
    if (!saveSessions(next)) { reportSaveError(); return; }
    if (!activate(prepared)) return;
    useLibraryAskHandoffStore.getState().consumeAsk(pending.nonce);
  }, [pending, ready, isActive, isProcessing, entryAttempt, activate, flush, reportSaveError]);

  return {
    activeId, sessions, ready, error, pending,
    newConversation: () => create({ selectedDocumentId: latest.current.snapshot.selectedDocumentId }),
    resume, rename, remove, flush,
    retryEntry: () => setEntryAttempt((value) => value + 1),
    dismissEntry: () => useLibraryAskHandoffStore.getState().consumeAsk(pending?.nonce),
  };
}
