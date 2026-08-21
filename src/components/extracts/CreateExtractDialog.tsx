import { useCallback, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Check,
  CircleNotch,
  Code,
  Eye,
  FolderOpen,
  Images,
  Lightbulb,
  List,
  Stack,
  Tag as TagIcon,
  TextB,
  TextItalic,
  TextUnderline,
  X,
} from "@phosphor-icons/react";
import { createExtract, updateExtract, CreateExtractInput, UpdateExtractInput, Extract } from "../../api/extracts";
import type { SelectionContext } from "../../types/selection";
import { generateLearningItemsFromExtract } from "../../api/learning-items";
import DOMPurify from "dompurify";
import { ClozeCreatorPopup } from "./ClozeCreatorPopup";
import { QACreatorPopup } from "./QACreatorPopup";
import { useToast } from "../common/Toast";
import { useDocumentStore } from "../../stores/documentStore";
import { useI18n } from "../../lib/i18n";
import { renderMarkdown } from "../../utils/markdown";
import {
  getImageAssetById,
  ingestImageFile,
  ingestRemoteImage,
  type ImageAsset,
} from "../../api/image-registry";
import {
  captureAppWindowRegion,
  saveScreenshotToRegistry,
} from "../../utils/screenshotCapture";
import { isNativeMobile, isTauri } from "../../lib/tauri";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";
import { ImageRegistryLibrary } from "../image-registry/ImageRegistryLibrary";
import type { DragEvent, ClipboardEvent as ReactClipboardEvent } from "react";

interface CreateExtractDialogProps {
  documentId: string;
  selectedText?: string;
  pageNumber?: number;
  selectionContext?: SelectionContext | null;
  initialHighlightColor?: string;
  isOpen: boolean;
  onClose: () => void;
  onCreate?: (extract: Extract) => void;
  /**
   * When provided the dialog edits this extract instead of creating one:
   * the single shared editor serves both funnels, so a quick-path extract
   * gains the same capabilities (annotations, article images, embedded
   * Image Registry) after creation (issue #44 bugs 08 + 12).
   */
  extract?: Extract;
}

// Common categories
const COMMON_CATEGORIES = [
  "Definition",
  "Concept",
  "Example",
  "Formula",
  "Quote",
  "Key Point",
  "Procedure",
];

// Common highlight colors
const HIGHLIGHT_COLORS = [
  { name: "Yellow", value: "#fef08a" },
  { name: "Green", value: "#bbf7d0" },
  { name: "Blue", value: "#bfdbfe" },
  { name: "Pink", value: "#fbcfe8" },
  { name: "Orange", value: "#fed7aa" },
  { name: "Purple", value: "#e9d5ff" },
];

// Annotation types
type AnnotationType = "bold" | "italic" | "underline" | "code" | "bullet";

const ANNOTATIONS = [
  { type: "bold" as AnnotationType, icon: TextB, label: "Bold (⌘/Ctrl+B)", prefix: "**", suffix: "**" },
  { type: "italic" as AnnotationType, icon: TextItalic, label: "Italic (⌘/Ctrl+I)", prefix: "_", suffix: "_" },
  { type: "underline" as AnnotationType, icon: TextUnderline, label: "Underline (⌘/Ctrl+U)", prefix: "<u>", suffix: "</u>" },
  { type: "code" as AnnotationType, icon: Code, label: "Code", prefix: "`", suffix: "`" },
  { type: "bullet" as AnnotationType, icon: List, label: "Bullet", prefix: "• ", suffix: "" },
];

const ANNOTATION_BY_TYPE = Object.fromEntries(
  ANNOTATIONS.map((annotation) => [annotation.type, annotation])
) as Record<AnnotationType, typeof ANNOTATIONS[number]>;

export function CreateExtractDialog({
  documentId,
  selectedText = "",
  pageNumber = 0,
  selectionContext = null,
  initialHighlightColor,
  isOpen,
  onClose,
  onCreate,
  extract,
}: CreateExtractDialogProps) {
  const isEditing = Boolean(extract);
  const [content, setContent] = useState(extract?.content ?? selectedText);
  const [notes, setNotes] = useState(extract?.notes ?? "");
  const [category, setCategory] = useState(extract?.category ?? "");
  const [tags, setTags] = useState<string[]>(extract?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [highlightColor, setHighlightColor] = useState(
    extract?.highlight_color || initialHighlightColor || HIGHLIGHT_COLORS[0].value
  );
  const [progressiveLevel, setProgressiveLevel] = useState(extract?.max_disclosure_level ?? 0);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [attachedArticleImages, setAttachedArticleImages] = useState<Array<{
    sourceUrl: string;
    alt: string;
    asset: ImageAsset;
  }>>([]);
  const [importingImageUrls, setImportingImageUrls] = useState<string[]>([]);
  const [visibleArticleImageCount, setVisibleArticleImageCount] = useState(24);
  const [showImageRegistry, setShowImageRegistry] = useState(false);
  const [registryAssets, setRegistryAssets] = useState<ImageAsset[]>([]);
  const [selectedRegistryImageIds, setSelectedRegistryImageIds] = useState<string[]>([]);
  const [creationMode, setCreationMode] = useState<"edit" | "cloze" | "qa">("edit");
  const [savedExtractId, setSavedExtractId] = useState<string | null>(null);
  const [isDialogDragOver, setIsDialogDragOver] = useState(false);
  const toast = useToast();
  const { t } = useI18n();
  const { documents } = useDocumentStore();
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // While a sub-creator (Cloze/QA) has replaced this dialog's content, that
  // component owns dismissal; our Escape/overlay handling must stand down.
  const subCreatorActive = Boolean(savedExtractId) && (creationMode === "cloze" || creationMode === "qa");
  useOverlayDismissal(isOpen && !subCreatorActive, onClose, 100);

  // Focus management matching the shared overlay contract: move focus into
  // the dialog on open, trap Tab inside it, restore focus on close.
  useEffect(() => {
    if (!isOpen || subCreatorActive) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleTab);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, subCreatorActive]);

  const currentDocument = documents.find((d) => d.id === documentId);
  const articleImages = Array.from(
    new Map(
      (currentDocument?.metadata?.extractedImages ?? [])
        .filter((image) => image.src?.trim())
        .map((image) => [image.src, image]),
    ).values(),
  );

  // Reset form when the dialog opens (create) or the target extract changes.
  useEffect(() => {
    if (isEditing) {
      setContent(extract!.content);
      setNotes(extract!.notes ?? "");
      setCategory(extract!.category ?? "");
      setTags(extract!.tags ?? []);
      setHighlightColor(extract!.highlight_color || HIGHLIGHT_COLORS[0].value);
      setProgressiveLevel(extract!.max_disclosure_level ?? 0);
      setShowPreview(false);
      setTagInput("");
      setAttachedArticleImages([]);
      setImportingImageUrls([]);
      setVisibleArticleImageCount(24);
      setShowImageRegistry(false);
      setSelectedRegistryImageIds([]);
      setError(null);
      return;
    }
    if (isOpen) {
      // Only update content if selectedText is provided (don't clear it if selectedText becomes empty on close)
      if (selectedText) {
        setContent(selectedText);
      }
      setNotes("");
      setCategory("");
      setTags([]);
      setTagInput("");
      setHighlightColor(initialHighlightColor || HIGHLIGHT_COLORS[0].value);
      setProgressiveLevel(0);
      setShowPreview(false);
      setAttachedArticleImages([]);
      setImportingImageUrls([]);
      setVisibleArticleImageCount(24);
      setShowImageRegistry(false);
      setSelectedRegistryImageIds([]);
      setError(null);
      setCreationMode("edit");
      setSavedExtractId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHighlightColor, isOpen, selectedText, extract]);

  // Annotations operate on the live selection of a known textarea via a ref.
  // The old `document.activeElement` guard made every toolbar button a no-op:
  // clicking the button blurred the textarea first (issue #44 bug 12).
  const applyAnnotation = useCallback(
    (annotation: typeof ANNOTATIONS[number]) => {
      const textarea = contentTextareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);

      const newText =
        content.substring(0, start) +
        annotation.prefix +
        selectedText +
        annotation.suffix +
        content.substring(end);

      setContent(newText);

      // Restore cursor position
      window.setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + annotation.prefix.length,
          end + annotation.prefix.length
        );
      }, 0);
    },
    [content]
  );

  const handleContentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const annotation =
      e.key === "b" || e.key === "B"
        ? ANNOTATION_BY_TYPE.bold
        : e.key === "i" || e.key === "I"
          ? ANNOTATION_BY_TYPE.italic
          : e.key === "u" || e.key === "U"
            ? ANNOTATION_BY_TYPE.underline
            : null;
    if (!annotation) return;
    e.preventDefault();
    applyAnnotation(annotation);
  };

  // Format content for preview (simple markdown-like rendering)
  const formatContent = (text: string) => {
    return renderMarkdown(text);
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAddTag();
    }
  };

  const attachArticleImage = async (
    image: { src: string; alt?: string },
    element: HTMLImageElement | null,
  ) => {
    if (attachedArticleImages.some((entry) => entry.sourceUrl === image.src)) {
      setAttachedArticleImages((entries) =>
        entries.filter((entry) => entry.sourceUrl !== image.src)
      );
      return;
    }
    if (importingImageUrls.includes(image.src)) return;

    setImportingImageUrls((urls) => [...urls, image.src]);
    setError(null);

    // Capture the already-rendered image before starting the network request.
    // Some sites allow an <img> to render but reject a second native download;
    // this gives those images a durable local fallback.
    let renderedFallback: string | null = null;
    if (isTauri() && !isNativeMobile() && element) {
      const rect = element.getBoundingClientRect();
      try {
        renderedFallback = await captureAppWindowRegion({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      } catch {
        renderedFallback = null;
      }
    }

    try {
      let asset: ImageAsset;
      try {
        const parsedUrl = new URL(image.src);
        const fileName =
          decodeURIComponent(parsedUrl.pathname.split("/").pop() || "") ||
          `article-image-${Date.now()}`;
        asset = await ingestRemoteImage(
          image.src,
          fileName,
          currentDocument?.metadata?.originalUrl ||
            currentDocument?.metadata?.url ||
            undefined,
        );
      } catch (downloadError) {
        if (!renderedFallback) throw downloadError;
        asset = await saveScreenshotToRegistry(
          renderedFallback,
          `article-image-${Date.now()}.png`,
        ) as ImageAsset;
      }

      setAttachedArticleImages((entries) => [
        ...entries,
        {
          sourceUrl: image.src,
          alt: image.alt || "",
          asset,
        },
      ]);
      window.dispatchEvent(new CustomEvent("refresh-image-registry"));
    } catch (imageError) {
      setError(
        imageError instanceof Error
          ? `Could not attach image: ${imageError.message}`
          : "Could not attach this image.",
      );
    } finally {
      setImportingImageUrls((urls) => urls.filter((url) => url !== image.src));
    }
  };

  // Dialog-level image routing (issue #44 bug 09): pasted images reach the
  // embedded registry through the canonical ingest pipeline regardless of
  // which inner element holds focus (WKWebView blocks clipboard.read(), so
  // only the paste event itself is trustworthy). Text pastes flow on
  // untouched to whatever is focused.
  const ingestPastedImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return false;

      setShowImageRegistry(true);
      const imported: ImageAsset[] = [];
      for (const image of images) {
        try {
          imported.push(await ingestImageFile(image));
        } catch (ingestError) {
          toast.error(
            t("extracts.imageIngestFailed"),
            ingestError instanceof Error ? ingestError.message : undefined
          );
        }
      }
      if (imported.length > 0) {
        setRegistryAssets((prev) => {
          const merged = [...imported, ...prev];
          const dedup = new Map(merged.map((asset) => [asset.id, asset]));
          return Array.from(dedup.values());
        });
        setSelectedRegistryImageIds((prev) =>
          Array.from(new Set([...prev, ...imported.map((asset) => asset.id)]))
        );
        window.dispatchEvent(new CustomEvent("refresh-image-registry"));
        toast.success(t("extracts.imageIngested"), t("extracts.imageIngestedDesc", { count: imported.length }));
      }
      return true;
    },
    [t, toast]
  );

  const handleDialogPasteCapture = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    const handled = event.clipboardData.getData("text/plain") === "" &&
      files.every((file) => file.type.startsWith("image/"));
    if (!handled) return;
    event.preventDefault();
    void ingestPastedImages(files);
  };

  // Dropped image files ingest + auto-select from anywhere in the dialog;
  // non-image drops are swallowed so the WebView never navigates to them.
  const handleDialogDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? []);
    setIsDialogDragOver(false);
    if (files.length > 0 || event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    setShowImageRegistry(true);
    void (async () => {
      const imported: ImageAsset[] = [];
      for (const image of images) {
        try {
          imported.push(await ingestImageFile(image));
        } catch (ingestError) {
          toast.error(
            t("extracts.imageIngestFailed"),
            ingestError instanceof Error ? ingestError.message : undefined
          );
        }
      }
      if (imported.length > 0) {
        setRegistryAssets((prev) => {
          const merged = [...imported, ...prev];
          const dedup = new Map(merged.map((asset) => [asset.id, asset]));
          return Array.from(dedup.values());
        });
        setSelectedRegistryImageIds((prev) =>
          Array.from(new Set([...prev, ...imported.map((asset) => asset.id)]))
        );
        window.dispatchEvent(new CustomEvent("refresh-image-registry"));
      }
    })();
  };

  const buildHtmlContent = async (): Promise<string> => {
    const selectedRegistryImages = await Promise.all(
      selectedRegistryImageIds.map(async (id) => {
        // Full-resolution rendition: the registry list thumbnail is a 256px
        // preview, not the asset (issue #44 bug 09).
        const full = await getImageAssetById(id);
        return full ?? registryAssets.find((asset) => asset.id === id) ?? null;
      })
    );
    const selectedImages = [
      ...attachedArticleImages.map(({ alt, asset }) => ({ alt, asset })),
      ...selectedRegistryImages
        .filter((asset): asset is ImageAsset => Boolean(asset))
        .map((asset) => ({ alt: asset.file_name || "Attached image", asset })),
    ].filter(
      (entry, index, entries) =>
        entries.findIndex(({ asset }) => asset.id === entry.asset.id) === index,
    );

    if (selectedImages.length > 0) {
      const wrapper = document.createElement("div");
      const text = document.createElement("div");
      text.innerHTML = DOMPurify.sanitize(formatContent(content.trim()));
      wrapper.appendChild(text);
      selectedImages.forEach(({ alt, asset }) => {
        const figure = document.createElement("figure");
        const element = document.createElement("img");
        element.src = asset.data_url;
        element.alt = alt;
        element.loading = "eager";
        figure.appendChild(element);
        if (alt) {
          const caption = document.createElement("figcaption");
          caption.textContent = alt;
          figure.appendChild(caption);
        }
        wrapper.appendChild(figure);
      });
      return DOMPurify.sanitize(wrapper.innerHTML);
    }

    // No images: still persist rendered formatting so text-only extracts
    // display their markdown in every reading surface.
    return DOMPurify.sanitize(formatContent(content.trim()));
  };

  const handleCreate = async (action: "extract" | "generate" | "cloze" | "qa") => {
    if (!content.trim()) {
      setError(t("extracts.contentRequired"));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const htmlContent = await buildHtmlContent();
      const input: CreateExtractInput = {
        document_id: documentId,
        content: content.trim(),
        html_content: htmlContent,
        source_url:
          currentDocument?.metadata?.originalUrl ||
          currentDocument?.metadata?.url ||
          (currentDocument?.filePath?.startsWith("http") ? currentDocument.filePath : undefined),
        note: notes.trim() || undefined,
        category: category || undefined,
        tags: tags.length > 0 ? tags : undefined,
        color: highlightColor,
        page_number: pageNumber || undefined,
        selection_context: selectionContext || undefined,
        max_disclosure_level: progressiveLevel > 0 ? progressiveLevel : undefined,
      };

      const created = await createExtract(input);
      toast.success(t("extracts.extractCreated"));

      if (action === "generate") {
        setIsGenerating(true);
        await generateLearningItemsFromExtract(created.id);
      }

      onCreate?.(created);
      if (action === "cloze" || action === "qa") {
        setSavedExtractId(created.id);
        setCreationMode(action);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extracts.failedToCreate"));
    } finally {
      setIsSaving(false);
      setIsGenerating(false);
    }
  };

  const handleUpdate = async (generateCards = false) => {
    if (!extract) return;
    if (!content.trim()) {
      setError(t("extracts.contentRequired"));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const htmlContent = await buildHtmlContent();
      const input: UpdateExtractInput = {
        id: extract.id,
        content: content.trim(),
        html_content: htmlContent,
        note: notes.trim() || undefined,
        category: category || undefined,
        tags: tags.length > 0 ? tags : undefined,
        color: highlightColor,
        max_disclosure_level: progressiveLevel > 0 ? progressiveLevel : undefined,
      };

      const updated = await updateExtract(input);

      if (generateCards) {
        setIsGenerating(true);
        await generateLearningItemsFromExtract(extract.id);
      }

      onCreate?.(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("extracts.failedToUpdate"));
    } finally {
      setIsSaving(false);
      setIsGenerating(false);
    }
  };

  if (creationMode === "cloze" && savedExtractId) {
    return (
      <ClozeCreatorPopup
        extractId={savedExtractId}
        selectedText={content}
        selectionRange={[0, content.length]}
        onCreated={() => onClose()}
        onCancel={onClose}
      />
    );
  }

  if (creationMode === "qa" && savedExtractId) {
    return (
      <QACreatorPopup
        extractId={savedExtractId}
        onCreated={() => onClose()}
        onCancel={onClose}
      />
    );
  }

  if (!isOpen) return null;

  return createPortal(
    <div
      className="adaptive-dialog-layer"
      onPasteCapture={handleDialogPasteCapture}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        setIsDialogDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsDialogDragOver(false);
      }}
      onDrop={handleDialogDrop}
    >
      <div className="adaptive-dialog-backdrop" aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? t("extracts.editTitle") : t("extracts.createTitle")}
        tabIndex={-1}
        className="adaptive-dialog-panel adaptive-dialog-centered transition-colors focus:outline-none"
        style={{
          maxWidth: "42rem",
          ...(isDialogDragOver
            ? { borderColor: "var(--color-primary)", borderStyle: "dashed" }
            : {}),
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditing ? t("extracts.editTitle") : t("extracts.createTitle")}
              </h2>
              {isEditing && extract && (
                <p className="text-sm text-muted-foreground">
                  {t("extracts.created")}: {new Date(extract.date_created).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Document Context */}
        {currentDocument && (
          <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-3">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{currentDocument.title}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">
                  {pageNumber > 0 ? `${t("extracts.page")} ${pageNumber}` : t("extracts.selectedText")}
                </span>
                {currentDocument.progressPercent !== undefined && currentDocument.progressPercent > 0 && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(currentDocument.progressPercent)}% {t("continueReading.complete")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isEditing && extract?.html_content && (
            <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-2">
              {t("extracts.editRichHint")}
            </p>
          )}

          {/* Content with Annotation Toolbar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-foreground">
                {t("extracts.content")} <span className="text-destructive">*</span>
              </label>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="px-2 py-1 text-xs bg-muted hover:bg-muted/80 text-muted-foreground rounded transition-colors flex items-center gap-1"
              >
                <Eye className="w-3 h-3" />
                {showPreview ? t("extracts.edit") : t("extracts.preview")}
              </button>
            </div>

            {/* Annotation Toolbar — mousedown is suppressed so the textarea
                keeps its focus and live selection (the old activeElement
                guard made these buttons dead). */}
            {!showPreview && (
              <div className="flex items-center gap-1 mb-2 p-2 bg-muted/50 rounded-md">
                {ANNOTATIONS.map((annotation) => (
                  <button
                    key={annotation.type}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyAnnotation(annotation)}
                    className="p-1.5 hover:bg-muted rounded transition-colors"
                    title={annotation.label}
                  >
                    <annotation.icon className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {t("extracts.selectTextToFormat")}
                </span>
              </div>
            )}

            {!showPreview ? (
              <textarea
                ref={contentTextareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleContentKeyDown}
                placeholder="Enter the extract content... Use **bold**, _italic_, `code`, or • for bullets"
                rows={4}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            ) : (
              <div className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground min-h-[100px]">
                {content ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatContent(content)) }}
                  />
                ) : (
                  <span className="text-muted-foreground">{t("extracts.previewHint")}</span>
                )}
              </div>
            )}
          </div>

          {articleImages.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                <Images className="w-4 h-4 inline mr-1" />
                Article images
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Choose any relevant image. It will be saved locally in the Image Registry and kept with the extract.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {articleImages
                  .slice(0, visibleArticleImageCount)
                  .map((image) => {
                    const selected = attachedArticleImages.some(
                      (entry) => entry.sourceUrl === image.src,
                    );
                    const importing = importingImageUrls.includes(image.src);
                    return (
                      <button
                        key={image.src}
                        type="button"
                        aria-pressed={selected}
                        disabled={importing}
                        onClick={(event) => {
                          const element = event.currentTarget.querySelector("img");
                          void attachArticleImage(image, element);
                        }}
                        className={`relative aspect-video overflow-hidden rounded-md border-2 transition-colors ${
                          selected ? "border-primary" : "border-border hover:border-primary/60"
                        } disabled:cursor-wait disabled:opacity-70`}
                        title={image.alt || "Article image"}
                      >
                        <img
                          src={image.src}
                          alt={image.alt || ""}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="h-full w-full bg-muted object-contain"
                        />
                        <span className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center rounded bg-background/90 px-1.5 text-[10px] text-foreground shadow">
                          {importing ? (
                            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                          ) : selected ? (
                            <Check className="h-3.5 w-3.5 text-primary" weight="bold" />
                          ) : (
                            "Add"
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
              {articleImages.length > visibleArticleImageCount && (
                <button
                  type="button"
                  onClick={() => setVisibleArticleImageCount((count) => count + 24)}
                  className="mt-2 w-full rounded-md border border-border px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  Show more article images
                </button>
              )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowImageRegistry((visible) => !visible)}
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <span className="inline-flex items-center gap-2">
                <Images className="h-4 w-4" />
                Attach from Image Registry
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedRegistryImageIds.length > 0
                  ? `${selectedRegistryImageIds.length} selected`
                  : showImageRegistry ? "Hide" : "Choose"}
              </span>
            </button>
            {showImageRegistry && (
              <ImageRegistryLibrary
                className="mt-3 max-h-[28rem] overflow-auto rounded-md border border-border"
                title="Image Registry"
                subtitle="Choose saved images or import, paste, and drop new ones."
                initialSelectedIds={selectedRegistryImageIds}
                onSelectedIdsChange={setSelectedRegistryImageIds}
                onAssetsChange={setRegistryAssets}
              />
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("extracts.notes")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add your thoughts, context, or explanations..."
              rows={2}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <FolderOpen className="w-4 h-4 inline mr-1" />
              {t("extracts.category")}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {COMMON_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(category === cat ? "" : cat)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    category === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Or enter custom category..."
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <TagIcon className="w-4 h-4 inline mr-1" />
              {t("extracts.tags")}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a tag..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleAddTag}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors"
              >
                {t("extracts.add")}
              </button>
            </div>
          </div>

          {/* Highlight Color */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("extracts.highlightColor")}
            </label>
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setHighlightColor(color.value)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    highlightColor === color.value
                      ? "border-primary scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Progressive Disclosure Level */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <Stack className="w-4 h-4 inline mr-1" />
              {t("extracts.progressiveDisclosure")}
            </label>
            <p className="text-xs text-muted-foreground mb-3">
              {t("extracts.progressiveDisclosureHint")}
            </p>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  onClick={() => setProgressiveLevel(level)}
                  className={`w-10 h-10 rounded-md transition-all ${
                    progressiveLevel === level
                      ? "bg-primary text-primary-foreground scale-105"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                  title={`${t("extracts.level")} ${level}`}
                >
                  {level}
                </button>
              ))}
            </div>
            {progressiveLevel > 0 && (
              <p className="text-xs text-primary mt-2">
                Extract will be revealed across {progressiveLevel} level{progressiveLevel > 1 ? "s" : ""}
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Responsive action hierarchy: phones get a structured two-column
              grid (primary pair, then specialized secondary actions, then a
              full-width Cancel); ≥lg restores the original single row. One
              set of DOM buttons is reordered with flex/grid ordering so both
              layouts share state, handlers, and labels.
              See openspec fix-mobile-layout-and-android-media-controls. */}
          <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center lg:justify-end lg:gap-3">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="order-5 col-span-2 min-h-11 px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-muted transition-colors disabled:opacity-50 lg:order-1 lg:col-span-1"
            >
              {t("common.cancel")}
            </button>
            {isEditing ? (
              <>
                <button
                  onClick={() => handleUpdate(false)}
                  disabled={isSaving || isGenerating}
                  className="order-1 min-h-11 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 lg:order-2"
                >
                  {isSaving ? t("extracts.updating") : t("extracts.updateExtract")}
                </button>
                <button
                  onClick={() => handleUpdate(true)}
                  disabled={isSaving || isGenerating}
                  className="order-2 min-h-11 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 lg:order-3 lg:inline-flex"
                >
                  {isGenerating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      {t("extracts.regeneratingCards")}
                    </>
                  ) : (
                    <span>{t("extracts.updateAndRegenerate")}</span>
                  )}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleCreate("extract")}
                  disabled={isSaving || isGenerating}
                  className="order-1 min-h-11 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 lg:order-2"
                >
                  {isSaving ? t("extracts.creating") : t("extracts.createExtract")}
                </button>
                <button
                  onClick={() => handleCreate("generate")}
                  disabled={isSaving || isGenerating}
                  className="order-2 min-h-11 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 lg:order-3 lg:inline-flex"
                >
                  {isGenerating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      {t("extracts.generatingCards")}
                    </>
                  ) : (
                    <span>{t("extracts.createAndGenerate")}</span>
                  )}
                </button>
                <button
                  onClick={() => handleCreate("cloze")}
                  disabled={isSaving || isGenerating}
                  className="order-3 min-h-11 px-3 py-2 bg-secondary text-secondary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 lg:order-4"
                >
                  {t("extracts.createAndCloze")}
                </button>
                <button
                  onClick={() => handleCreate("qa")}
                  disabled={isSaving || isGenerating}
                  className="order-4 min-h-11 px-3 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 transition-colors disabled:opacity-50 lg:order-5"
                >
                  {t("extracts.createAndQA")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
