import { useMemo, useState } from "react";
import { BookOpen, Highlighter, PencilSimple, Trash } from "@phosphor-icons/react";
import { createExtract, updatePdfAnnotation, type Extract } from "../../api/extracts";
import { useI18n } from "../../lib/i18n";
import {
  isPdfTextMarkup, PDF_MARKUP_COLORS, PDF_REGION_MARKUP, PDF_TEXT_MARKUP,
  type PdfAnnotation, type PdfAnnotationPatch,
} from "../../lib/pdf/annotationModel";
import type { PdfRegionMarkupKind, PdfSelectionContext, PdfTextMarkupKind } from "../../types/selection";
import { normalizePdfHighlightColor } from "../../utils/highlightColors";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { Button } from "../md3/Button";

export interface PdfAnnotationDraft {
  context: PdfSelectionContext;
  content: string;
  kind?: PdfTextMarkupKind | PdfRegionMarkupKind;
}

export interface PdfAnnotationsRequest {
  documentId: string;
  annotationId?: string;
  draft?: PdfAnnotationDraft;
}

const field = "w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const markupNames = {
  highlight: "viewer.pdfMarkupHighlight", underline: "viewer.pdfMarkupUnderline",
  strikethrough: "viewer.pdfMarkupStrikethrough", note: "viewer.pdfMarkupNote",
  rectangle: "viewer.pdfMarkupRectangle", ellipse: "viewer.pdfMarkupEllipse",
  ink: "viewer.pdfMarkupInk", freeText: "viewer.pdfMarkupFreeText", stamp: "viewer.pdfMarkupStamp",
} as const;

type EditableEntry = PdfAnnotation | PdfAnnotationDraft;

function MarkupEditor({ entry, onSave, onCancel, busy }: {
  entry: EditableEntry;
  onSave: (fields: { note: string; color: typeof PDF_MARKUP_COLORS[number]; kind?: PdfTextMarkupKind }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const initialKind = "markup" in entry ? entry.markup.kind : entry.kind ?? "highlight";
  const [kind, setKind] = useState(initialKind);
  const [note, setNote] = useState("note" in entry ? entry.note ?? "" : "");
  const [color, setColor] = useState(normalizePdfHighlightColor("color" in entry ? entry.color : undefined));
  const required = kind === "note" || kind === "freeText" || kind === "stamp";
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!busy && (!required || note.trim())) {
        onSave({ note: note.trim(), color, kind: isPdfTextMarkup(kind) ? kind : undefined });
      }
    }}>
      <p className="line-clamp-3 text-sm text-muted-foreground">{entry.content}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span>{t("viewer.pdfMarkupType")}</span>
          <select className={field} value={kind} disabled={!isPdfTextMarkup(initialKind) || busy}
            onChange={(event) => setKind(event.target.value as PdfTextMarkupKind)}>
            {(isPdfTextMarkup(initialKind) ? PDF_TEXT_MARKUP : [initialKind]).map((value) =>
              <option key={value} value={value}>{t(markupNames[value])}</option>,
            )}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{t("viewer.pdfMarkupColor")}</span>
          <select className={field} value={color} disabled={busy}
            onChange={(event) => setColor(event.target.value as typeof color)}>
            {PDF_MARKUP_COLORS.map((value) => <option key={value} value={value}>{t(`viewer.${value}Highlight`)}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span>{t("viewer.pdfMarkupNote")}</span>
        <textarea className={field} value={note} onChange={(event) => setNote(event.target.value)}
          rows={3} maxLength={4000} required={required} disabled={busy} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="text" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={busy || (required && !note.trim())}>{t("common.save")}</Button>
      </div>
    </form>
  );
}

export function PdfAnnotationsPanel({
  request, annotations, onClose, onPersist, onNavigate, onCloze, onBeginRegion,
}: {
  request: PdfAnnotationsRequest;
  annotations: PdfAnnotation[];
  onClose: () => void;
  onPersist: (extract: Extract) => void;
  onNavigate: (annotation: PdfAnnotation) => void;
  onCloze: (annotation: PdfAnnotation) => void;
  onBeginRegion?: (kind: PdfRegionMarkupKind) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filterColor, setFilterColor] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [sortByPage, setSortByPage] = useState(true);
  const [entry, setEntry] = useState<EditableEntry | null>(
    request.draft ?? annotations.find((item) => item.id === request.annotationId) ?? null,
  );
  const [undo, setUndo] = useState<PdfAnnotationPatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const selected = entry && "id" in entry ? entry.id : undefined;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return annotations
      .filter((annotation) => (includeRemoved || !annotation.markup.removed)
        && (!filterColor || normalizePdfHighlightColor(annotation.color) === filterColor)
        && (!needle || `${annotation.content}\n${annotation.note ?? ""}`.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => sortByPage
        ? a.pages[0].pageNumber - b.pages[0].pageNumber || a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt));
  }, [annotations, filterColor, includeRemoved, query, sortByPage]);
  const close = () => { if (!busy) onClose(); };

  const perform = async (request: () => Promise<Extract>, success: (saved: Extract) => void) => {
    setBusy(true);
    setError(false);
    try {
      const saved = await request();
      onPersist(saved);
      success(saved);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const patchFor = (annotation: PdfAnnotation): PdfAnnotationPatch => ({
    id: annotation.id, documentId: annotation.documentId, expectedModifiedAt: annotation.modifiedAt,
  });
  const save = (fields: { note: string; color: typeof PDF_MARKUP_COLORS[number]; kind?: PdfTextMarkupKind }) => {
    if (!entry) return;
    if ("id" in entry) {
      void perform(() => updatePdfAnnotation({ ...patchFor(entry), ...fields }), () => setEntry(null));
      return;
    }
    const kind = fields.kind ?? entry.kind ?? "highlight";
    void perform(() => createExtract({
      document_id: request.documentId,
      content: entry.content || fields.note || t(markupNames[kind]),
      page_number: entry.context.pages[0]?.pageNumber,
      note: fields.note,
      color: fields.color,
      selection_context: {
        ...entry.context,
        pdfMarkup: { ...entry.context.pdfMarkup, version: 1, kind },
      },
    }), () => setEntry(null));
  };

  const toggleRemoved = (annotation: PdfAnnotation, removed: boolean) => {
    const patch = patchFor(annotation);
    void perform(() => updatePdfAnnotation({ ...patch, removed }), (saved) => {
      if (selected === annotation.id) setEntry(null);
      setUndo(removed ? { ...patch, expectedModifiedAt: saved.date_modified, removed: false } : null);
    });
  };

  return (
    <ResponsiveDialogSheet open onClose={close} title={t("viewer.pdfAnnotations")} closeLabel={t("common.close")}>
      {error && <p role="alert" className="mb-3 text-sm text-error">{t("viewer.pdfMarkupError")}</p>}
      {entry ? (
        <MarkupEditor key={selected ?? "draft"} entry={entry} busy={busy} onSave={save}
          onCancel={() => { setEntry(null); setError(false); }} />
      ) : (
        <div className="space-y-3">
          {onBeginRegion && <label className="block space-y-1 text-sm">
            <span>{t("viewer.pdfMarkupDraw")}</span>
            <select className={field} value="" disabled={busy} onChange={(event) => {
              if (event.target.value) onBeginRegion(event.target.value as PdfRegionMarkupKind);
            }}>
              <option value="">{t("viewer.pdfMarkupChooseTool")}</option>
              {PDF_REGION_MARKUP.map((kind) => <option key={kind} value={kind}>{t(markupNames[kind])}</option>)}
            </select>
          </label>}
          <input className={field} type="search" aria-label={t("viewer.pdfMarkupSearch")}
            placeholder={t("viewer.pdfMarkupSearch")} value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span>{t("viewer.pdfMarkupColor")}</span>
              <select className={field} value={filterColor} onChange={(event) => setFilterColor(event.target.value)}>
                <option value="">{t("viewer.pdfMarkupAllColors")}</option>
                {PDF_MARKUP_COLORS.map((color) => <option key={color} value={color}>{t(`viewer.${color}Highlight`)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("viewer.pdfMarkupSort")}</span>
              <select className={field} value={sortByPage ? "page" : "recent"} onChange={(event) => setSortByPage(event.target.value === "page")}>
                <option value="page">{t("viewer.pdfMarkupPageOrder")}</option>
                <option value="recent">{t("viewer.pdfMarkupNewest")}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-muted-foreground">{t("viewer.pdfMarkupCount", { count: visible.length })}</p>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={includeRemoved} onChange={(event) => setIncludeRemoved(event.target.checked)} />
              {t("viewer.pdfMarkupShowRemoved")}
            </label>
          </div>
          {undo && <div className="flex items-center justify-between gap-2 border-y border-border py-1">
            <p className="text-sm" role="status">{t("viewer.pdfMarkupRemoved")}</p>
            <Button variant="text" disabled={busy} onClick={() => {
              void perform(() => updatePdfAnnotation(undo), () => setUndo(null));
            }}>{t("viewer.pdfMarkupUndo")}</Button>
          </div>}
          {visible.length === 0 && <p className="py-4 text-sm text-muted-foreground">
            {annotations.length ? t("viewer.pdfMarkupNoMatches") : t("viewer.pdfMarkupEmpty")}
          </p>}
          <ul className="divide-y divide-border">
            {visible.map((annotation) => (
              <li key={annotation.id} className="py-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Highlighter size={14} aria-hidden="true" />
                  <span>{t("viewer.page", { current: annotation.pages[0].pageNumber })}</span>
                  <span>{t(markupNames[annotation.markup.kind] ?? markupNames.highlight)}</span>
                </div>
                <p className="mt-1 line-clamp-3 break-words text-sm text-foreground">{annotation.content}</p>
                {annotation.note && annotation.content !== annotation.note && <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{annotation.note}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button variant="tonal" size="sm" onClick={() => onNavigate(annotation)} disabled={busy}>
                    <BookOpen size={14} aria-hidden="true" />{t("viewer.pdfMarkupViewSource")}
                  </Button>
                  {annotation.markup.removed ? (
                    <Button variant="text" size="sm" disabled={busy} onClick={() => toggleRemoved(annotation, false)}>{t("viewer.pdfMarkupRestore")}</Button>
                  ) : (
                    <>
                      <Button variant="text" size="sm" disabled={busy} onClick={() => {
                        setEntry(annotation);
                        setError(false);
                      }}><PencilSimple size={14} aria-hidden="true" />{t("common.edit")}</Button>
                      {isPdfTextMarkup(annotation.markup.kind) && <Button variant="text" size="sm" disabled={busy}
                        onClick={() => onCloze(annotation)}>{t("viewer.pdfMarkupCloze")}</Button>}
                      <Button variant="text" size="sm" disabled={busy} onClick={() => toggleRemoved(annotation, true)}>
                        <Trash size={14} aria-hidden="true" />{t("viewer.pdfMarkupRemove")}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ResponsiveDialogSheet>
  );
}
