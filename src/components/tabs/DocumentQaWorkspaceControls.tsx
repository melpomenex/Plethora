import { useMemo, useState } from "react";
import { BookOpen, Check, List, MagnifyingGlass, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import type { Document } from "../../types/document";
import { useI18n } from "../../lib/i18n";
import { formatRelativeTime } from "../../utils/relativeTime";
import { Button } from "../md3/Button";
import { Dialog } from "../md3/Dialog";
import type { DocumentQaSession } from "./documentQaSessions";
import { useDocumentStore } from "../../stores/documentStore";
import { PLACEHOLDER_TITLE, STORAGE_KEYS } from "./documentQaSessions";

export function DocumentQaSourcePicker({ open, onClose, documents, selectedId, libraryLabel, onSelect }: {
  open: boolean; onClose: () => void; documents: Document[];
  selectedId: string; libraryLabel: string; onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => documents.filter((doc) =>
    !doc.isAiExcluded && doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [documents, query]);
  const select = (id: string) => { onSelect(id); onClose(); };
  return (
    <Dialog open={open} onClose={onClose} title={t("qaWorkspace.chooseSources")} closeLabel={t("tabs.cancel")}>
      <label className="mb-2 block text-sm" htmlFor="qa-source-search">{t("qaWorkspace.searchSources")}</label>
      <div className="mb-3 flex min-h-11 items-center gap-2 rounded-lg border border-outline bg-surface-container-lowest px-3">
        <MagnifyingGlass aria-hidden="true" />
        <input id="qa-source-search" value={query} onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 outline-none" autoComplete="off" />
      </div>
      <Button variant="tonal" className="mb-3 w-full justify-start whitespace-normal text-left" onClick={() => select("")}>
        <BookOpen className="shrink-0" aria-hidden="true" />{libraryLabel}{!selectedId && <Check aria-hidden="true" />}
      </Button>
      <ul className="max-h-[45dvh] space-y-1 overflow-auto" aria-label={t("qaWorkspace.chooseDocument")}>
        {matches.slice(0, 60).map((doc) => (
          <li key={doc.id}>
            <button type="button" onClick={() => select(doc.id)} aria-pressed={selectedId === doc.id}
              className="md-state md-focus-ring flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm">
              <BookOpen className="shrink-0 text-on-surface-variant" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words">{doc.title}</span>
              {selectedId === doc.id && <Check className="shrink-0 text-primary" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="py-4 text-sm text-on-surface-variant">{t("qaWorkspace.noSources")}</p>}
      {matches.length > 60 && <p className="mt-3 text-sm text-on-surface-variant">{t("qaWorkspace.refineSources")}</p>}
    </Dialog>
  );
}

export function DocumentQaHistory({ sessions, activeId, busy, onNew, onResume, onRename, onDelete, open, onClose }: {
  sessions: DocumentQaSession[]; activeId: string | null; busy: boolean;
  onNew: () => void; onResume: (id: string) => void;
  onRename: (id: string, title: string) => void; onDelete: (id: string) => void;
  open: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const documents = useDocumentStore((state) => state.documents);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === "1");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const closeRail = () => { localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, "1"); setCollapsed(true); };
  const saveTitle = (id: string) => { onRename(id, title); setEditing(null); };
  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 p-3">
        <Button className="min-w-0 flex-1 px-3" onClick={() => { onNew(); onClose(); }} disabled={busy}>
          <Plus aria-hidden="true" />{t("qaWorkspace.newConversation")}
        </Button>
        {!open && <Button variant="text" size="icon" onClick={closeRail} aria-label={t("tabs.collapseSidebar")}><List /></Button>}
      </div>
      <h2 className="px-4 pb-2 text-sm font-medium text-on-surface-variant">{t("tabs.chatHistory")}</h2>
      <ul className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <div role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-current={session.id === activeId ? "true" : undefined}
              onClick={() => { if (!busy && !editing) { onResume(session.id); onClose(); } }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || busy) return;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onResume(session.id); onClose(); }
              }}
              className={`md-focus-ring rounded-lg px-3 py-2 ${session.id === activeId ? "bg-secondary-container text-on-secondary-container" : "hover:bg-surface-container-high"}`}>
              {editing === session.id ? <input autoFocus aria-label={t("tabs.rename")} value={title}
                className="min-h-10 w-full rounded border border-outline bg-surface-container-lowest px-2"
                onClick={(event) => event.stopPropagation()} onChange={(event) => setTitle(event.target.value)}
                onBlur={() => saveTitle(session.id)} onKeyDown={(event) => {
                  if (event.key === "Enter") { event.stopPropagation(); saveTitle(session.id); }
                  if (event.key === "Escape") setEditing(null);
                }} /> : <p className="break-words text-sm font-medium">{session.title === PLACEHOLDER_TITLE ? t("qaWorkspace.newConversation") : session.title}</p>}
              <p className="mt-1 truncate text-xs text-on-surface-variant">{formatRelativeTime(session.updatedAt)} · {session.documentName || documents.find((doc) => doc.id === session.selectedDocumentId)?.title || t("tabs.wholeLibrary")}</p>
              <div className="mt-1 flex justify-end">
                <Button variant="text" size="icon" disabled={busy} aria-label={t("tabs.rename")}
                  onClick={(event) => { event.stopPropagation(); setEditing(session.id); setTitle(session.title); }}><PencilSimple aria-hidden="true" /></Button>
                <Button variant="text" size="icon" disabled={busy} aria-label={t("tabs.deleteSession")}
                  onClick={(event) => { event.stopPropagation(); setDeleting(session.id); }}><Trash aria-hidden="true" /></Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-4 py-3 text-xs text-on-surface-variant">{t("tabs.sidebarCapNote")}</p>
    </div>
  );
  return <>
    {!collapsed && <aside className="hidden w-64 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low lg:flex">{list}</aside>}
    <Dialog open={open} onClose={onClose} title={t("qaWorkspace.history")} closeLabel={t("tabs.cancel")} className="max-w-lg">
      {list}
    </Dialog>
    <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} title={t("tabs.deleteSession")} description={t("tabs.deleteSessionConfirm")}
      footer={<><Button variant="text" onClick={() => setDeleting(null)}>{t("tabs.cancel")}</Button><Button variant="destructive" disabled={busy}
        onClick={() => { if (deleting) onDelete(deleting); setDeleting(null); }}>{t("tabs.deleteSession")}</Button></>}>
      <p className="text-sm text-on-surface-variant">{t("qaWorkspace.savedItemsUnaffected")}</p>
    </Dialog>
  </>;
}
