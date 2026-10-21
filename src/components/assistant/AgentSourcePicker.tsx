import { useMemo, useState } from "react";
import { Check, FileText, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { Button, SearchField } from "../md3";
import { useDocumentStore } from "../../stores";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";
import type { Document } from "../../types/document";

const MAX_VISIBLE_DOCUMENTS = 50;

/**
 * Library document picker for the Learning Agent's "Attach document" action.
 *
 * A library can hold hundreds of documents with long academic titles, so the
 * picker is a searchable sheet/dialog rather than an anchored menu: the list
 * scrolls inside the surface, titles ellipsize, and the surface is always
 * bounded by the viewport. Attached documents stay visible with a checked
 * state so several sources can be added or removed without reopening.
 */
export function AgentSourcePicker({
  excludeDocumentId,
  attachedIds,
  onToggle,
  onClose,
}: {
  /** The current reader document is already implicit; never list it twice. */
  excludeDocumentId?: string;
  attachedIds: string[];
  onToggle: (document: Document) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const documents = useDocumentStore((state) => state.documents);
  const [query, setQuery] = useState("");

  const attached = useMemo(() => new Set(attachedIds), [attachedIds]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents
      .filter(
        (document) =>
          !document.isArchived &&
          !document.isAiExcluded &&
          document.id !== excludeDocumentId,
      )
      .filter(
        (document) =>
          needle.length === 0 || document.title.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.dateModified < b.dateModified ? 1 : -1));
  }, [documents, excludeDocumentId, query]);
  // Keep the first paint light for very large libraries; search narrows the
  // list and the hint below makes the cap explicit.
  const candidates = filtered.slice(0, MAX_VISIBLE_DOCUMENTS);
  const hasEligibleDocuments = useMemo(
    () =>
      documents.some(
        (document) =>
          !document.isArchived &&
          !document.isAiExcluded &&
          document.id !== excludeDocumentId,
      ),
    [documents, excludeDocumentId],
  );

  return (
    <ResponsiveDialogSheet
      open
      onClose={onClose}
      title={t("assistant.agent.addSource")}
      description={t("assistant.agent.pickerDescription")}
      closeLabel={t("common.close")}
      className="agent-source-picker"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-on-surface-variant" role="status">
            {attached.size > 0
              ? t("assistant.agent.pickerSelected", { count: attached.size })
              : t("assistant.agent.pickerNone")}
          </p>
          <Button variant="filled" onClick={onClose}>
            {t("common.done")}
          </Button>
        </div>
      }
    >
      <div className="sticky top-0 z-10 bg-surface-container-high pb-2">
        <SearchField
          label={t("flashcardStudio.searchDocuments")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      {filtered.length > candidates.length && (
        <p className="px-1 pb-1 pt-2 text-[11px] text-on-surface-variant" role="status">
          {t("assistant.agent.pickerMore", {
            shown: candidates.length,
            count: filtered.length,
          })}
        </p>
      )}

      {candidates.length > 0 ? (
        <div
          role="group"
          aria-label={t("assistant.agent.addSource")}
          className="mt-3 flex flex-col gap-0.5"
        >
          {candidates.map((document) => {
            const isAttached = attached.has(document.id);
            return (
              <button
                key={document.id}
                type="button"
                data-agent-source-option={document.id}
                aria-pressed={isAttached}
                onClick={() => onToggle(document)}
                className={cn(
                  "md-state flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-start",
                  isAttached && "bg-secondary-container/60",
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                  <FileText size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-on-surface">
                  {document.title}
                </span>
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    isAttached ? "bg-primary text-primary-foreground" : "text-on-surface-variant",
                  )}
                  aria-hidden="true"
                >
                  {isAttached ? <Check size={16} weight="bold" /> : <Plus size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center" role="status">
          <MagnifyingGlass size={22} className="text-on-surface-variant" aria-hidden="true" />
          <p className="text-sm text-on-surface-variant">
            {hasEligibleDocuments
              ? t("flashcardStudio.noDocumentsFound")
              : t("assistant.agent.pickerEmpty")}
          </p>
        </div>
      )}
    </ResponsiveDialogSheet>
  );
}
