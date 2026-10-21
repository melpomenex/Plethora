import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FrameCorners, PencilSimple, X } from "@phosphor-icons/react";
import type { ImageAsset } from "../../../api/image-registry";
import { useLatexPreview } from "../../../hooks/useLatexPreview";
import { useI18n } from "../../../lib/i18n";
import type {
  ImageOcclusionRegion,
  MultipleChoiceOption,
} from "../../../types/learningItemInteractions";
import { cn } from "../../../utils";
import { OcclusionLightbox } from "../../occlusion/OcclusionLightbox";
import { StudioOcclusionComposerLauncher } from "./StudioOcclusionComposerLauncher";
import type { DraftCard, DraftCardType } from "./types";

export type { DraftCard, DraftCardType } from "./types";

// ── Text & Cloze Utilities ───────────────────────────────────────────────────

export function highlightCloze(text: string): React.ReactElement {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{([^}]+)\}\}$/);
        if (match) {
          const content = match[1].replace(/^c\d+::/, "");
          return (
            <span key={i} className="bg-primary/20 text-primary font-semibold px-1 rounded">
              {content}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function stripClozeMarkup(text: string): string {
  return text.replace(/\{\{(.*?)\}\}/g, "$1");
}

export function mapPlainOffsetToMarkedOffset(markedText: string, plainOffset: number): number {
  if (plainOffset <= 0) return 0;

  let plainIndex = 0;
  let markedIndex = 0;

  while (markedIndex < markedText.length) {
    if (markedText.startsWith("{{", markedIndex) || markedText.startsWith("}}", markedIndex)) {
      markedIndex += 2;
      continue;
    }
    if (plainIndex === plainOffset) {
      return markedIndex;
    }
    plainIndex += 1;
    markedIndex += 1;
  }

  return markedText.length;
}

export function wrapMarkedTextByPlainOffsets(
  markedText: string,
  startOffset: number,
  endOffset: number
): string {
  const openIndex = mapPlainOffsetToMarkedOffset(markedText, startOffset);
  const closeIndex = mapPlainOffsetToMarkedOffset(markedText, endOffset);
  if (openIndex >= closeIndex) return markedText;

  const before = markedText.slice(Math.max(0, openIndex - 2), openIndex);
  const after = markedText.slice(closeIndex, closeIndex + 2);
  if (before === "{{" && after === "}}") {
    return markedText;
  }

  return `${markedText.slice(0, openIndex)}{{${markedText.slice(openIndex, closeIndex)}}}${markedText.slice(closeIndex)}`;
}

/**
 * Backdrop dismiss that survives the Android soft keyboard.
 */
export function useBackdropDismiss(onClose: () => void) {
  const pressedBackdrop = useRef(false);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      pressedBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent) => {
      const dismiss = event.target === event.currentTarget && pressedBackdrop.current;
      pressedBackdrop.current = false;
      if (dismiss) onClose();
    },
  };
}

// ── CardEditLightbox Component ───────────────────────────────────────────────

export interface CardEditLightboxProps {
  isOpen: boolean;
  card: DraftCard;
  editForm: Partial<DraftCard>;
  onEditFormChange: React.Dispatch<React.SetStateAction<Partial<DraftCard>>>;
  sourceExcerpt?: string;
  imageAssets: ImageAsset[];
  defaultImageAssetId?: string;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
}

export function CardEditLightbox({
  isOpen,
  card,
  editForm,
  onEditFormChange,
  sourceExcerpt,
  imageAssets,
  defaultImageAssetId,
  onSave,
  onCancel,
  onClose,
}: CardEditLightboxProps) {
  const { t } = useI18n();
  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceExcerptRef = useRef<HTMLDivElement>(null);
  const [sourceSelection, setSourceSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [canUndoCloze, setCanUndoCloze] = useState(false);
  const lastClozeTextRef = useRef<string | null>(null);

  const activeType = (editForm.type as DraftCardType | undefined) || card.type;
  const trimmedSourceExcerpt = sourceExcerpt?.trim() || "";

  const setType = (type: DraftCardType) => {
    onEditFormChange((form) => ({
      ...form,
      type,
      question: type === "cloze" ? undefined : (form.question as string) || "",
      answer: type === "cloze" ? undefined : (form.answer as string) || "",
      text:
        type === "cloze"
          ? ((form.text as string) || trimmedSourceExcerpt || "")
          : undefined,
      multipleChoiceOptions:
        type === "multiple-choice"
          ? Array.isArray(form.multipleChoiceOptions) && form.multipleChoiceOptions.length > 0
            ? form.multipleChoiceOptions
            : [{ id: "choice-1", text: "" }, { id: "choice-2", text: "" }]
          : undefined,
      multipleChoiceCorrectOptionId:
        type === "multiple-choice"
          ? (form.multipleChoiceCorrectOptionId as string | undefined) || "choice-1"
          : undefined,
      imageOcclusionAssetId:
        type === "image-occlusion"
          ? (form.imageOcclusionAssetId as string | undefined) || defaultImageAssetId
          : undefined,
      imageOcclusionRegions:
        type === "image-occlusion"
          ? Array.isArray(form.imageOcclusionRegions)
            ? form.imageOcclusionRegions
            : []
          : undefined,
    }));
  };

  const wrapClozeSelection = () => {
    const textarea = clozeTextareaRef.current;
    const currentText = (editForm.text as string) || "";
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = currentText.slice(start, end);
    const wrapped = `{{${selectedText}}}`;
    const nextText = currentText.slice(0, start) + wrapped + currentText.slice(end);

    lastClozeTextRef.current = currentText;
    setCanUndoCloze(true);
    onEditFormChange((form) => ({ ...form, text: nextText }));
    requestAnimationFrame(() => {
      if (!clozeTextareaRef.current) return;
      clozeTextareaRef.current.focus();
      clozeTextareaRef.current.selectionStart = start;
      clozeTextareaRef.current.selectionEnd = start + wrapped.length;
    });
  };

  const undoClozeWrap = () => {
    if (lastClozeTextRef.current === null) return;
    onEditFormChange((form) => ({ ...form, text: lastClozeTextRef.current! }));
    lastClozeTextRef.current = null;
    setCanUndoCloze(false);
  };

  const updateSourceSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = sourceExcerptRef.current;
    if (!selection || selection.isCollapsed || !container || !selection.rangeCount) {
      setSourceSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSourceSelection(null);
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const text = selection.toString();
    const endOffset = startOffset + text.length;

    if (!text.trim() || endOffset <= startOffset) {
      setSourceSelection(null);
      return;
    }

    setSourceSelection({
      text,
      startOffset,
      endOffset,
    });
  }, []);

  const applySourceSelectionAsCloze = () => {
    if (!sourceSelection || !trimmedSourceExcerpt) return;

    const currentText = ((editForm.text as string) || "").trim();
    const hasCompatibleBase =
      currentText.length > 0 && stripClozeMarkup(currentText) === trimmedSourceExcerpt;
    const baseText = hasCompatibleBase ? currentText : trimmedSourceExcerpt;
    const nextText = wrapMarkedTextByPlainOffsets(
      baseText,
      sourceSelection.startOffset,
      sourceSelection.endOffset
    );

    lastClozeTextRef.current = baseText;
    setCanUndoCloze(true);
    onEditFormChange((form) => ({ ...form, text: nextText }));
    setSourceSelection(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => clozeTextareaRef.current?.focus());
  };

  const previewContent =
    activeType === "qa"
      ? `${editForm.question || ""}\n---\n${editForm.answer || ""}`
      : activeType === "cloze"
      ? editForm.text || ""
      : activeType === "multiple-choice"
      ? `${editForm.question || ""}\n${(editForm.multipleChoiceOptions || []).map((option) => option.text).join("\n")}\n${editForm.answer || ""}`
      : `${editForm.question || ""}\n${editForm.answer || ""}`;
  const { html: previewHtml, isPending: previewPending } = useLatexPreview(previewContent);

  const backdropDismiss = useBackdropDismiss(onClose);

  if (!isOpen) return null;

  const inputCls =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "block text-xs font-medium text-muted-foreground mb-1";

  return (
    <div
      {...backdropDismiss}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-4xl max-h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-foreground">
              {t("flashcardStudio.editCardTitle")}
            </h2>
            <select
              value={activeType}
              onChange={(e) => setType(e.target.value as DraftCardType)}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="qa">{t("flashcardStudio.cardTypeQaShort")}</option>
              <option value="cloze">{t("flashcardStudio.cardTypeCloze")}</option>
              <option value="multiple-choice">{t("flashcardStudio.cardTypeMultipleChoice")}</option>
              <option value="image-occlusion">{t("flashcardStudio.cardTypeImageOcclusion")}</option>
            </select>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeType === "cloze" ? (
            <div className="space-y-3 max-w-3xl mx-auto">
              {trimmedSourceExcerpt && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Source Extract
                    </span>
                    <div className="flex items-center gap-2">
                      {sourceSelection && (
                        <button
                          type="button"
                          onClick={applySourceSelectionAsCloze}
                          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Cloze selection
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditFormChange((form) => ({ ...form, text: trimmedSourceExcerpt }))}
                        className="text-xs font-medium text-primary hover:opacity-80"
                      >
                        Use full extract
                      </button>
                    </div>
                  </div>
                  <div
                    ref={sourceExcerptRef}
                    onMouseUp={updateSourceSelection}
                    onKeyUp={updateSourceSelection}
                    className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground select-text rounded-md border border-transparent p-1"
                  >
                    {trimmedSourceExcerpt}
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Highlight text above and click <span className="font-medium text-foreground">Cloze selection</span>.
                    </p>
                    {sourceSelection && (
                      <div className="max-w-[45%] rounded-md bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">
                        Selected: <span className="text-foreground">{sourceSelection.text.trim()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col flex-1">
                <span className={labelCls}>{t("flashcardStudio.clozeTextLabel")}</span>
                <textarea
                  ref={clozeTextareaRef}
                  value={(editForm.text as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, text: e.target.value }))}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                      e.preventDefault();
                      wrapClozeSelection();
                    }
                  }}
                  className={`${inputCls} flex-1 min-h-[200px] resize-y font-mono`}
                  rows={8}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Select text and press <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Ctrl+B</kbd> to wrap as Cloze.
                  </p>
                  <div className="flex items-center gap-1.5">
                    {canUndoCloze && (
                      <button
                        type="button"
                        onClick={undoClozeWrap}
                        className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      >
                        {t("flashcardStudio.undoCloze")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={wrapClozeSelection}
                      className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                    >
                      Wrap selection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeType === "qa" ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.question")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={4}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.answer")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={6}
                />
              </div>
            </div>
          ) : activeType === "multiple-choice" ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.question")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={labelCls}>{t("flashcardStudio.choices")}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onEditFormChange((form) => ({
                        ...form,
                        multipleChoiceOptions: [
                          ...(form.multipleChoiceOptions || []),
                          { id: `choice-${(form.multipleChoiceOptions?.length || 0) + 1}`, text: "" },
                        ],
                      }))
                    }
                    className="text-xs text-primary hover:opacity-80"
                  >
                    {t("flashcardStudio.addChoice")}
                  </button>
                </div>
                {(editForm.multipleChoiceOptions || []).map((option, index) => (
                  <div key={option.id || index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-lightbox-${card.id}`}
                      checked={editForm.multipleChoiceCorrectOptionId === option.id}
                      onChange={() =>
                        onEditFormChange((form) => ({
                          ...form,
                          multipleChoiceCorrectOptionId: option.id,
                        }))
                      }
                    />
                    <input
                      value={option.text}
                      onChange={(e) =>
                        onEditFormChange((form) => ({
                          ...form,
                          multipleChoiceOptions: (form.multipleChoiceOptions || []).map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, text: e.target.value } : entry
                          ),
                        }))
                      }
                      placeholder={t("flashcardStudio.choiceNumber", { count: index + 1 })}
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.explanationOptional")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.prompt")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={3}
                  placeholder={t("flashcardStudio.imagePromptPlaceholder")}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.revealExplanation")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.sourceImage")}</span>
                <select
                  value={(editForm.imageOcclusionAssetId as string | undefined) || ""}
                  onChange={(e) =>
                    onEditFormChange((form) => ({
                      ...form,
                      imageOcclusionAssetId: e.target.value || undefined,
                    }))
                  }
                  className={inputCls}
                >
                  <option value="">{t("flashcardStudio.selectImportedImage")}</option>
                  {imageAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.file_name || asset.id}
                    </option>
                  ))}
                </select>
              </div>
              <StudioOcclusionComposerLauncher
                assetId={editForm.imageOcclusionAssetId}
                regions={(editForm.imageOcclusionRegions as ImageOcclusionRegion[] | undefined) || []}
                onRegionsChange={(regions) =>
                  onEditFormChange((form) => ({ ...form, imageOcclusionRegions: regions }))
                }
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          {previewHtml && (
            <div className="mb-3 rounded-md border border-border/50 bg-muted/30 p-3 text-sm max-h-32 overflow-y-auto">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("flashcardStudio.preview")} {previewPending && <span className="opacity-50">...</span>}
              </div>
              <div
                className="prose prose-sm max-w-none [&_.math-expression-block]:my-1 [&_.math-expression-block]:flex [&_.math-expression-block]:justify-center"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("flashcardStudio.cancel")}
            </button>
            <button
              onClick={onSave}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              {t("flashcardStudio.saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── CardPreview / DraftCardEditor Component ──────────────────────────────────

export interface DraftCardEditorProps {
  card: DraftCard;
  isFlipped: boolean;
  onFlip: () => void;
  isEditing: boolean;
  onEdit: () => void;
  onSaveEdit: (updates: Partial<DraftCard>) => void;
  sourceExcerpt?: string;
  imageAssets?: ImageAsset[];
  defaultImageAssetId?: string;
}

export function CardPreview({
  card,
  isFlipped,
  onFlip,
  isEditing,
  onEdit,
  onSaveEdit,
  sourceExcerpt,
  imageAssets = [],
  defaultImageAssetId,
}: DraftCardEditorProps) {
  const { t } = useI18n();
  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceExcerptRef = useRef<HTMLDivElement>(null);
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false);
  const [isEditLightboxOpen, setIsEditLightboxOpen] = useState(false);
  const [canUndoCloze, setCanUndoCloze] = useState(false);
  const lastClozeTextRef = useRef<string | null>(null);
  const [sourceSelection, setSourceSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [editForm, setEditForm] = useState<Partial<DraftCard>>({
    type: card.type,
    question: card.question || "",
    answer: card.answer || "",
    text: card.text || "",
    multipleChoiceOptions: card.multipleChoiceOptions || [
      { id: "choice-1", text: "" },
      { id: "choice-2", text: "" },
    ],
    multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
    imageOcclusionAssetId: card.imageOcclusionAssetId || defaultImageAssetId,
    imageOcclusionRegions: card.imageOcclusionRegions || [],
  });

  useEffect(() => {
    setEditForm({
      type: card.type,
      question: card.question || "",
      answer: card.answer || "",
      text: card.text || "",
      multipleChoiceOptions: card.multipleChoiceOptions || [
        { id: "choice-1", text: "" },
        { id: "choice-2", text: "" },
      ],
      multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
      imageOcclusionAssetId: card.imageOcclusionAssetId || defaultImageAssetId,
      imageOcclusionRegions: card.imageOcclusionRegions || [],
    });
    setSourceSelection(null);
  }, [card, defaultImageAssetId]);

  const activeType = (editForm.type as DraftCardType | undefined) || card.type;
  const previewContent =
    activeType === "qa"
      ? `${editForm.question || ""}\n---\n${editForm.answer || ""}`
      : activeType === "cloze"
      ? editForm.text || ""
      : activeType === "multiple-choice"
      ? `${editForm.question || ""}\n${(editForm.multipleChoiceOptions || []).map((option) => option.text).join("\n")}\n${editForm.answer || ""}`
      : `${editForm.question || ""}\n${editForm.answer || ""}`;
  const { html: previewHtml, isPending: previewPending } = useLatexPreview(previewContent);
  const previewAssetId = (editForm.imageOcclusionAssetId as string | undefined) || defaultImageAssetId;
  const previewAsset = imageAssets.find((asset) => asset.id === previewAssetId) || null;
  const trimmedSourceExcerpt = sourceExcerpt?.trim() || "";

  const setType = (type: DraftCardType) => {
    setEditForm((form) => ({
      ...form,
      type,
      question: type === "cloze" ? undefined : (form.question as string) || "",
      answer: type === "cloze" ? undefined : (form.answer as string) || "",
      text:
        type === "cloze"
          ? (form.text as string) || trimmedSourceExcerpt || ""
          : undefined,
      multipleChoiceOptions:
        type === "multiple-choice"
          ? Array.isArray(form.multipleChoiceOptions) && form.multipleChoiceOptions.length > 0
            ? form.multipleChoiceOptions
            : [{ id: "choice-1", text: "" }, { id: "choice-2", text: "" }]
          : undefined,
      multipleChoiceCorrectOptionId:
        type === "multiple-choice"
          ? (form.multipleChoiceCorrectOptionId as string | undefined) || "choice-1"
          : undefined,
      imageOcclusionAssetId:
        type === "image-occlusion"
          ? (form.imageOcclusionAssetId as string | undefined) || defaultImageAssetId
          : undefined,
      imageOcclusionRegions:
        type === "image-occlusion"
          ? Array.isArray(form.imageOcclusionRegions)
            ? form.imageOcclusionRegions
            : []
          : undefined,
    }));
  };

  const wrapClozeSelection = () => {
    const textarea = clozeTextareaRef.current;
    const currentText = (editForm.text as string) || "";
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = currentText.slice(start, end);
    const wrapped = `{{${selectedText}}}`;
    const nextText = currentText.slice(0, start) + wrapped + currentText.slice(end);

    lastClozeTextRef.current = currentText;
    setCanUndoCloze(true);
    setEditForm((form) => ({ ...form, text: nextText }));
    requestAnimationFrame(() => {
      if (!clozeTextareaRef.current) return;
      clozeTextareaRef.current.focus();
      clozeTextareaRef.current.selectionStart = start;
      clozeTextareaRef.current.selectionEnd = start + wrapped.length;
    });
  };

  const undoClozeWrap = () => {
    if (lastClozeTextRef.current === null) return;
    setEditForm((form) => ({ ...form, text: lastClozeTextRef.current! }));
    lastClozeTextRef.current = null;
    setCanUndoCloze(false);
  };

  const updateSourceSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = sourceExcerptRef.current;
    if (!selection || selection.isCollapsed || !container || !selection.rangeCount) {
      setSourceSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSourceSelection(null);
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const text = selection.toString();
    const endOffset = startOffset + text.length;

    if (!text.trim() || endOffset <= startOffset) {
      setSourceSelection(null);
      return;
    }

    setSourceSelection({
      text,
      startOffset,
      endOffset,
    });
  }, []);

  const applySourceSelectionAsCloze = () => {
    if (!sourceSelection || !trimmedSourceExcerpt) return;

    const currentText = ((editForm.text as string) || "").trim();
    const hasCompatibleBase =
      currentText.length > 0 && stripClozeMarkup(currentText) === trimmedSourceExcerpt;
    const baseText = hasCompatibleBase ? currentText : trimmedSourceExcerpt;
    const nextText = wrapMarkedTextByPlainOffsets(
      baseText,
      sourceSelection.startOffset,
      sourceSelection.endOffset
    );

    lastClozeTextRef.current = baseText;
    setCanUndoCloze(true);
    setEditForm((form) => ({ ...form, text: nextText }));
    setSourceSelection(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => clozeTextareaRef.current?.focus());
  };

  const editLightbox = (
    <CardEditLightbox
      isOpen={isEditLightboxOpen}
      card={card}
      editForm={editForm}
      onEditFormChange={setEditForm}
      sourceExcerpt={sourceExcerpt}
      imageAssets={imageAssets}
      defaultImageAssetId={defaultImageAssetId}
      onSave={() => {
        onSaveEdit(editForm);
        setIsEditLightboxOpen(false);
      }}
      onCancel={() => setIsEditLightboxOpen(false)}
      onClose={() => setIsEditLightboxOpen(false)}
    />
  );

  if (isEditing) {
    return (
      <>
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              {t("flashcardStudio.cardTypeLabel")}
            </label>
            <button
              type="button"
              onClick={() => setIsEditLightboxOpen(true)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t("flashcardStudio.expandEditor")}
            >
              <FrameCorners className="w-3.5 h-3.5" />
            </button>
          </div>
          <select
            value={activeType}
            onChange={(e) => setType(e.target.value as DraftCardType)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="qa">{t("flashcardStudio.cardTypeQaShort")}</option>
            <option value="cloze">{t("flashcardStudio.cardTypeCloze")}</option>
            <option value="multiple-choice">{t("flashcardStudio.cardTypeMultipleChoice")}</option>
            <option value="image-occlusion">{t("flashcardStudio.cardTypeImageOcclusion")}</option>
          </select>

          {activeType === "qa" ? (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.question")}
                </label>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.answer")}
                </label>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={3}
                />
              </div>
            </>
          ) : activeType === "cloze" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {t("flashcardStudio.clozeTextLabel")}
              </label>
              {trimmedSourceExcerpt && (
                <div className="mt-1.5 mb-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Source Extract
                    </span>
                    <div className="flex items-center gap-2">
                      {sourceSelection && (
                        <button
                          type="button"
                          onClick={applySourceSelectionAsCloze}
                          className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                        >
                          Cloze selection
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditForm((form) => ({ ...form, text: trimmedSourceExcerpt }))}
                        className="text-[10px] font-medium text-primary hover:opacity-80"
                      >
                        Use full extract
                      </button>
                    </div>
                  </div>
                  <div
                    ref={sourceExcerptRef}
                    onMouseUp={updateSourceSelection}
                    onKeyUp={updateSourceSelection}
                    className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground select-text rounded-md border border-transparent px-1 py-0.5"
                  >
                    {trimmedSourceExcerpt}
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <p className="text-[11px] text-muted-foreground">
                      Highlight a word or phrase in the extract, then use{" "}
                      <span className="font-medium text-foreground">Cloze selection</span> to hide it in context.
                    </p>
                    {sourceSelection && (
                      <div className="max-w-[45%] rounded-md bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
                        Selected: <span className="text-foreground">{sourceSelection.text.trim()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <textarea
                ref={clozeTextareaRef}
                value={(editForm.text as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, text: e.target.value }))}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                    e.preventDefault();
                    wrapClozeSelection();
                  }
                }}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={4}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Select text and press{" "}
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                    Ctrl+B
                  </kbd>{" "}
                  to wrap it as a Cloze deletion.
                </p>
                <div className="flex items-center gap-1.5">
                  {canUndoCloze && (
                    <button
                      type="button"
                      onClick={undoClozeWrap}
                      className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    >
                      {t("flashcardStudio.undoCloze")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={wrapClozeSelection}
                    className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15"
                  >
                    Wrap selection
                  </button>
                </div>
              </div>
            </div>
          ) : activeType === "multiple-choice" ? (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.question")}
                </label>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("flashcardStudio.choices")}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEditForm((form) => ({
                        ...form,
                        multipleChoiceOptions: [
                          ...(form.multipleChoiceOptions || []),
                          {
                            id: `choice-${(form.multipleChoiceOptions?.length || 0) + 1}`,
                            text: "",
                          },
                        ],
                      }))
                    }
                    className="text-xs text-primary hover:opacity-80"
                  >
                    {t("flashcardStudio.addChoice")}
                  </button>
                </div>
                {(editForm.multipleChoiceOptions || []).map((option, index) => (
                  <div key={option.id || index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${card.id}`}
                      checked={editForm.multipleChoiceCorrectOptionId === option.id}
                      onChange={() =>
                        setEditForm((form) => ({
                          ...form,
                          multipleChoiceCorrectOptionId: option.id,
                        }))
                      }
                    />
                    <input
                      value={option.text}
                      onChange={(e) =>
                        setEditForm((form) => ({
                          ...form,
                          multipleChoiceOptions: (form.multipleChoiceOptions || []).map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, text: e.target.value } : entry
                          ),
                        }))
                      }
                      placeholder={t("flashcardStudio.choiceNumber", { count: index + 1 })}
                      className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.explanationOptional")}
                </label>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={2}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.prompt")}
                </label>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={2}
                  placeholder={t("flashcardStudio.imagePromptPlaceholder")}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.revealExplanation")}
                </label>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("flashcardStudio.sourceImage")}
                </label>
                <select
                  value={(editForm.imageOcclusionAssetId as string | undefined) || ""}
                  onChange={(e) =>
                    setEditForm((form) => ({
                      ...form,
                      imageOcclusionAssetId: e.target.value || undefined,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">{t("flashcardStudio.selectImportedImage")}</option>
                  {imageAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.file_name || asset.id}
                    </option>
                  ))}
                </select>
              </div>
              <StudioOcclusionComposerLauncher
                assetId={editForm.imageOcclusionAssetId}
                regions={(editForm.imageOcclusionRegions as ImageOcclusionRegion[] | undefined) || []}
                onRegionsChange={(regions) =>
                  setEditForm((form) => ({ ...form, imageOcclusionRegions: regions }))
                }
              />
            </>
          )}

          {previewHtml && (
            <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-sm">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("flashcardStudio.preview")} {previewPending && <span className="opacity-50">...</span>}
              </div>
              <div
                className="prose prose-sm max-w-none [&_.math-expression-block]:my-1 [&_.math-expression-block]:flex [&_.math-expression-block]:justify-center"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => onSaveEdit({})}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("flashcardStudio.cancel")}
            </button>
            <button
              onClick={() => onSaveEdit(editForm)}
              className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90"
            >
              {t("flashcardStudio.saveChanges")}
            </button>
          </div>
        </div>
        {editLightbox}
      </>
    );
  }

  return (
    <div onClick={onFlip} className="cursor-pointer group perspective-1000">
      <div
        className={cn(
          "relative min-h-[100px] rounded-xl border bg-card p-4 transition-all duration-300",
          "hover:border-primary/30 hover:shadow-md",
          isFlipped && card.type === "qa" ? "ring-2 ring-primary/20" : "border-border"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            {card.type === "qa" ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">
                  {isFlipped ? t("flashcardStudio.answerLabel") : t("flashcardStudio.questionLabel")}
                </div>
                <div className="text-sm text-foreground/90 leading-relaxed">
                  {isFlipped ? card.answer : card.question}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {isFlipped
                    ? t("flashcardStudio.clickToSeeQuestion")
                    : t("flashcardStudio.clickToRevealAnswer")}
                </div>
              </div>
            ) : card.type === "multiple-choice" ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">{card.question}</div>
                <div className="space-y-1.5">
                  {(card.multipleChoiceOptions || []).map((option) => (
                    <div
                      key={option.id}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-sm",
                        isFlipped && card.multipleChoiceCorrectOptionId === option.id
                          ? "border-green-500/40 bg-green-500/10"
                          : "border-border bg-background"
                      )}
                    >
                      {option.text}
                    </div>
                  ))}
                </div>
                {isFlipped && card.answer && (
                  <div className="text-xs text-muted-foreground">{card.answer}</div>
                )}
              </div>
            ) : card.type === "image-occlusion" ? (
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">
                  {card.question || t("flashcardStudio.imageOcclusionCard")}
                </div>
                {previewAsset ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsImageLightboxOpen(true);
                      }}
                      className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-black/80"
                    >
                      <FrameCorners className="h-3 w-3" />
                      {t("flashcardStudio.expandImage")}
                    </button>
                    <img
                      src={previewAsset.data_url}
                      alt={previewAsset.file_name || t("flashcardStudio.occlusionSource")}
                      className="w-full object-contain"
                    />
                    {!isFlipped &&
                      (card.imageOcclusionRegions || []).map((region, index) => (
                        <div
                          key={region.id || `${region.x}-${region.y}-${index}`}
                          className="absolute rounded border border-white/30 bg-slate-950/80"
                          style={{
                            left: `${region.x}%`,
                            top: `${region.y}%`,
                            width: `${region.width}%`,
                            height: `${region.height}%`,
                          }}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("flashcardStudio.selectImageForOcclusion")}
                  </div>
                )}
                {isFlipped && card.answer && (
                  <div className="text-xs text-muted-foreground">{card.answer}</div>
                )}
                {previewAsset ? (
                  <OcclusionLightbox
                    isOpen={isImageLightboxOpen}
                    asset={previewAsset}
                    regions={(card.imageOcclusionRegions || []) as ImageOcclusionRegion[]}
                    title={card.question || previewAsset.file_name || t("flashcardStudio.imageOcclusionCard")}
                    onClose={() => setIsImageLightboxOpen(false)}
                  />
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-foreground/90 leading-relaxed">
                {highlightCloze(card.text || "")}
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-muted transition-opacity"
          >
            <PencilSimple className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {editLightbox}
    </div>
  );
}

export const DraftCardEditor = CardPreview;
export default DraftCardEditor;
