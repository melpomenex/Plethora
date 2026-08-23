import {
  ArrowsVertical,
  CalendarBlank,
  Camera,
  CaretDown,
  Check,
  ClipboardText,
  DotsThree,
  FrameCorners,
  Images,
  Lightning,
  Link,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { describeImage, generateImageCards } from "../../lib/ai/imageAI";
import { createLearningItem } from "../../api/learning-items";

import {
  deleteImageAsset,
  renameImageAsset,
  ingestImageBlob,
  ingestImageFile,
  listImageAssets,
  type ImageAsset,
} from "../../api/image-registry";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { ItemTagEditor } from "../common/ItemTagEditor";
import { useToast } from "../common/Toast";

type SortMode = "newest" | "oldest" | "name" | "size";

const EMPTY_SELECTED_IDS: string[] = [];

export interface ImageRegistryLibraryProps {
  className?: string;
  initialSelectedIds?: string[];
  onSelectedIdsChange?: (ids: string[]) => void;
  onConfirmSelection?: (ids: string[]) => void;
  onClose?: () => void;
  onAssetsChange?: (assets: ImageAsset[]) => void;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  showCloseButton?: boolean;
  showConfirmButton?: boolean;
}

export function ImageRegistryLibrary({
  className,
  initialSelectedIds = EMPTY_SELECTED_IDS,
  onSelectedIdsChange,
  onConfirmSelection,
  onClose,
  onAssetsChange,
  title,
  subtitle,
  confirmLabel,
  showCloseButton = false,
  showConfirmButton = false,
}: ImageRegistryLibraryProps) {
  const { t } = useI18n();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const toolbarMenuRef = useRef<HTMLDivElement>(null);

  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(initialSelectedIds[0] ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [isBusy, setIsBusy] = useState(false);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [openToolbarMenu, setOpenToolbarMenu] = useState<"add" | "actions" | null>(null);

  useEffect(() => {
    if (!openToolbarMenu) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!toolbarMenuRef.current?.contains(event.target as Node)) {
        setOpenToolbarMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenToolbarMenu(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openToolbarMenu]);

  const assetTags = useCallback((asset: { metadata?: Record<string, unknown> }): string[] => {
    const tags = asset.metadata?.tags;
    if (!Array.isArray(tags)) return [];
    return tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  }, []);

  useEffect(() => {
    setSelectedIds(initialSelectedIds);
  }, [initialSelectedIds]);

  const loadAssets = useCallback(async () => {
    try {
      const nextAssets = await listImageAssets();
      setAssets(Array.isArray(nextAssets) ? nextAssets : []);
      onAssetsChange?.(Array.isArray(nextAssets) ? nextAssets : []);
    } catch (error) {
      console.error("Failed to load image registry library", error);
      toast.error(t("imageRegistry.loadFailed"), error instanceof Error ? error.message : undefined);
    }
  }, [onAssetsChange]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    const handleRefresh = () => {
      void loadAssets();
    };
    window.addEventListener("refresh-image-registry", handleRefresh);
    return () => {
      window.removeEventListener("refresh-image-registry", handleRefresh);
    };
  }, [loadAssets]);

  useEffect(() => {
    if (previewAssetId) return;
    if (assets.length === 0) return;
    setPreviewAssetId(assets[0].id);
  }, [assets, previewAssetId]);

  const commitSelectedIds = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setSelectedIds((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onSelectedIdsChange?.(next);
      return next;
    });
  }, [onSelectedIdsChange]);

  const markHighlighted = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHighlightedIds(ids);
    window.setTimeout(() => {
      setHighlightedIds((prev) => prev.filter((id) => !ids.includes(id)));
    }, 2400);
  }, []);

  const mergeImportedAssets = useCallback((imported: ImageAsset[]) => {
    const previousIds = new Set(assets.map((asset) => asset.id));
    const duplicateCount = imported.filter((asset) => previousIds.has(asset.id)).length;
    const importedIds = imported.map((asset) => asset.id);

    setAssets((prev) => {
      const merged = [...imported, ...prev];
      const dedup = new Map(merged.map((asset) => [asset.id, asset]));
      const next = Array.from(dedup.values());
      onAssetsChange?.(next);
      return next;
    });

    commitSelectedIds((prev) => Array.from(new Set([...prev, ...importedIds])));
    setPreviewAssetId(importedIds[0] ?? null);
    markHighlighted(importedIds);

    const newCount = imported.length - duplicateCount;
    if (newCount > 0) {
      toast.success(
        t("imageRegistry.assetsAdded"),
        duplicateCount > 0
          ? t("imageRegistry.assetsAddedWithDuplicates", { added: newCount, duplicates: duplicateCount })
          : t("imageRegistry.assetsAddedDesc", { count: newCount })
      );
      return;
    }

    if (duplicateCount > 0) {
      toast.info(t("imageRegistry.duplicateReused"), t("imageRegistry.duplicateReusedDesc", { count: duplicateCount }));
    }
  }, [assets, commitSelectedIds, markHighlighted, onAssetsChange, t, toast]);

  const ingestFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsBusy(true);
    try {
      const imported = await Promise.all(files.map((file) => ingestImageFile(file)));
      mergeImportedAssets(imported);
    } catch (error) {
      toast.error(t("imageRegistry.importFailed"), error instanceof Error ? error.message : undefined);
    } finally {
      setIsBusy(false);
    }
  }, [mergeImportedAssets, t, toast]);

  const handleFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    await ingestFiles(files);
    event.target.value = "";
  }, [ingestFiles]);

  const handlePasteImage = useCallback(async () => {
    setIsBusy(true);
    try {
      if (!navigator.clipboard?.read) {
        throw new Error(t("imageRegistry.clipboardUnavailable"));
      }

      const clipboardItems = await navigator.clipboard.read();
      const blobs: Blob[] = [];
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          blobs.push(await item.getType(imageType));
        }
      }

      if (blobs.length === 0) {
        throw new Error(t("imageRegistry.clipboardEmpty"));
      }

      const imported = await Promise.all(
        blobs.map((blob, index) => ingestImageBlob(blob, `clipboard-image-${Date.now()}-${index + 1}.png`))
      );
      mergeImportedAssets(imported);
    } catch (error) {
      console.warn("Programmatic clipboard paste failed, instructing keyboard shortcut:", error);
      toast.info(
        "Use keyboard shortcut to paste",
        "Your system blocks programmatic clipboard reading. Please copy an image and use Cmd+V (Mac) or Ctrl+V (Windows/Linux) directly on this page to paste your image."
      );
    } finally {
      setIsBusy(false);
    }
  }, [mergeImportedAssets, t, toast]);

  const handlePasteCapture = useCallback(async (event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;

    event.preventDefault();
    await ingestFiles(files);
  }, [ingestFiles]);

  /** Open the Image Occlusion Composer for an asset already in the registry. */
  const dispatchOcclusionRequest = useCallback((assetId: string) => {
    window.dispatchEvent(
      new CustomEvent("plethora:create-image-occlusion", {
        detail: { assetId },
      }),
    );
  }, []);

  /**
   * Ingested images get a generated name (`saved-image-<timestamp>.png`), which
   * is unusable for finding anything later. Renaming is display-only: cards and
   * extracts reference the asset by id, so an existing reference cannot break.
   *
   * Rename is inline (like a file manager) rather than a modal prompt: on start,
   * only the base name is pre-selected so typing doesn't clobber the extension.
   */
  // Escape removes the (focused) input from the DOM, which can synchronously fire a
  // native blur event; this flag stops that blur from re-committing after cancel.
  const renameCancelingRef = useRef(false);

  const startRenameAsset = useCallback((assetId: string, currentName: string) => {
    setRenamingAssetId(assetId);
    setRenameValue(currentName);
  }, []);

  const cancelRenameAsset = useCallback(() => {
    renameCancelingRef.current = true;
    setRenamingAssetId(null);
    setRenameValue("");
  }, []);

  useEffect(() => {
    if (!renamingAssetId) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    const lastDot = renameValue.lastIndexOf(".");
    const baseNameEnd = lastDot > 0 ? lastDot : renameValue.length;
    input.setSelectionRange(0, baseNameEnd);
    // Only run when entering edit mode, not on every renameValue keystroke.
  }, [renamingAssetId]);

  const commitRenameAsset = useCallback(async (assetId: string, currentName: string) => {
    if (renameCancelingRef.current) {
      renameCancelingRef.current = false;
      return;
    }
    const nextName = renameValue.trim();
    if (!nextName || nextName === currentName) {
      cancelRenameAsset();
      return;
    }
    if (nextName.length > 200) {
      toast.error(t("imageRegistry.rename"), t("imageRegistry.renameTooLong"));
      return;
    }

    setRenameSaving(true);
    try {
      const updated = await renameImageAsset(assetId, nextName);
      setAssets((prev) => {
        const next = prev.map((asset) =>
          asset.id === assetId ? { ...asset, file_name: updated.file_name } : asset,
        );
        onAssetsChange?.(next);
        return next;
      });
      cancelRenameAsset();
    } catch (error) {
      toast.error(
        t("imageRegistry.rename"),
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRenameSaving(false);
    }
  }, [cancelRenameAsset, onAssetsChange, renameValue, t, toast]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;

    setIsBusy(true);
    try {
      const results = await Promise.all(selectedIds.map((id) => deleteImageAsset(id)));
      const deletedIds = selectedIds.filter((_, index) => results[index]?.deleted);
      const blocked = results.filter((result) => !result.deleted);

      if (deletedIds.length > 0) {
        setAssets((prev) => {
          const next = prev.filter((asset) => !deletedIds.includes(asset.id));
          onAssetsChange?.(next);
          return next;
        });
        commitSelectedIds((prev) => prev.filter((id) => !deletedIds.includes(id)));
        toast.success(t("imageRegistry.assetsDeleted"), t("imageRegistry.assetsDeletedDesc", { count: deletedIds.length }));
      }

      if (blocked.length > 0) {
        toast.warning(
          t("imageRegistry.deleteBlocked"),
          blocked[0]?.reason || t("imageRegistry.deleteBlockedDesc")
        );
      }
    } catch (error) {
      toast.error(t("imageRegistry.deleteFailed"), error instanceof Error ? error.message : undefined);
    } finally {
      setIsBusy(false);
    }
  }, [commitSelectedIds, onAssetsChange, selectedIds, t, toast]);

  const sortedAssets = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const filtered = normalizedQuery.length === 0
      ? assets
      : assets.filter((asset) => {
          const fileName = asset.file_name?.toLowerCase() ?? "";
          return fileName.includes(normalizedQuery) || asset.sha256.toLowerCase().includes(normalizedQuery);
        });

    const next = [...filtered];
    switch (sortMode) {
      case "oldest":
        next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "name":
        next.sort((a, b) => (a.file_name || a.id).localeCompare(b.file_name || b.id));
        break;
      case "size":
        next.sort((a, b) => b.byte_size - a.byte_size);
        break;
      case "newest":
      default:
        next.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
    }
    return next;
  }, [assets, searchQuery, sortMode]);

  const previewAsset = useMemo(
    () => sortedAssets.find((asset) => asset.id === previewAssetId) || assets.find((asset) => asset.id === previewAssetId) || null,
    [assets, previewAssetId, sortedAssets]
  );

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.includes(asset.id)),
    [assets, selectedIds]
  );

  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleGenerateCardsAndAddToDeck = async () => {
    if (!previewAsset || isBusy) return;
    setIsBusy(true);
    try {
      const parts = previewAsset.data_url.split(",");
      const mimeMatch = /data:(image\/\w+);base64/.exec(parts[0]);
      const mimeType = (mimeMatch?.[1] as "image/jpeg" | "image/png" | "image/webp") || "image/png";
      const dataBase64 = parts[1] || "";
      const generated = await generateImageCards({ mimeType, dataBase64 });
      if (!generated || generated.length === 0) {
        toast.info("No Cards Generated", "The model did not return any valid flashcards for this image.");
        return;
      }

      // Create flashcards attached to this image asset
      let createdCount = 0;
      for (const card of generated) {
        await createLearningItem({
          item_type: card.card_type === "cloze" ? "Cloze" : "Flashcard",
          question: card.question,
          answer: card.answer,
          cloze_text: card.cloze_text,
          tags: ["image-study"],
          image_asset_ids: [previewAsset.id],
        });
        createdCount++;
      }
      toast.success(
        "Cards Added to Deck",
        `Created ${createdCount} flashcards from snapped image attached to deck!`
      );
    } catch (error) {
      toast.error("Card Generation Failed", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDescribePreview = async () => {
    if (!previewAsset || isBusy) return;
    setIsBusy(true);
    try {
      const parts = previewAsset.data_url.split(",");
      const mimeMatch = /data:(image\/\w+);base64/.exec(parts[0]);
      const mimeType = (mimeMatch?.[1] as "image/jpeg" | "image/png" | "image/webp") || "image/png";
      const dataBase64 = parts[1] || "";
      const res = await describeImage({ mimeType, dataBase64 });
      toast.info(res.suggestedTitle || "Image Analysis", res.description);
    } catch (error) {
      toast.error("AI Analysis Failed", error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  // Drag-and-drop ingest: image files go through the canonical
  // ingestImageFile pipeline (with its type/size validation) and land
  // selected; non-image drops are ignored quietly — no error pages.
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      setIsDragOver(false);
      // Always swallow file drops inside the library so the WebView never
      // navigates to a dropped file, regardless of type.
      if (files.length > 0 || event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      void ingestFiles(images);
    },
    [ingestFiles]
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-[28px] border bg-background/95 shadow-xl transition-colors",
        isDragOver ? "border-primary border-dashed bg-primary/5" : "border-border/70",
        className
      )}
      onPasteCapture={handlePasteCapture}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="relative z-30 border-b border-border/70 bg-gradient-to-r from-primary/6 via-background to-secondary/10 px-3 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="shrink-0 rounded-xl bg-primary/12 p-2 text-primary">
              <Images className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {title || t("imageRegistry.title")}
              </h2>
              <p className="hidden truncate text-xs text-muted-foreground sm:block sm:text-sm">
                {subtitle || t("imageRegistry.subtitle")}
              </p>
            </div>
          </div>

          <div ref={toolbarMenuRef} className="flex shrink-0 items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div className="relative">
              <button
                type="button"
                aria-label="Add images"
                aria-haspopup="menu"
                aria-expanded={openToolbarMenu === "add"}
                onClick={() => setOpenToolbarMenu((current) => current === "add" ? null : "add")}
                disabled={isBusy}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:translate-y-px disabled:opacity-60"
              >
                <Plus className="h-4 w-4" weight="bold" />
                <span className="hidden min-[360px]:inline sm:hidden">Add</span>
                <span className="hidden sm:inline">Add images</span>
                <CaretDown className="hidden h-3.5 w-3.5 sm:block" />
              </button>
              {openToolbarMenu === "add" ? (
                <div role="menu" aria-label="Add images" className="absolute right-0 top-[calc(100%+0.5rem)] w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
                  <ToolbarMenuButton icon={Camera} label="Snap photo" description="Use your device camera" onClick={() => {
                    setOpenToolbarMenu(null);
                    cameraInputRef.current?.click();
                  }} />
                  <ToolbarMenuButton icon={Images} label={t("imageRegistry.upload")} description="Choose one or more files" onClick={() => {
                    setOpenToolbarMenu(null);
                    fileInputRef.current?.click();
                  }} />
                  <ToolbarMenuButton icon={ClipboardText} label={t("imageRegistry.paste")} description="Import the image on your clipboard" onClick={() => {
                    setOpenToolbarMenu(null);
                    void handlePasteImage();
                  }} />
                  <p className="mx-2 mt-1 border-t border-border/70 px-1 pb-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {t("imageRegistry.pasteHint")}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label="Image actions"
                aria-haspopup="menu"
                aria-expanded={openToolbarMenu === "actions"}
                onClick={() => setOpenToolbarMenu((current) => current === "actions" ? null : "actions")}
                className="relative inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted active:translate-y-px"
              >
                <DotsThree className="h-5 w-5" weight="bold" />
                <span className="hidden sm:inline">Actions</span>
                {selectedIds.length > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-5 text-primary-foreground tabular-nums">
                    {selectedIds.length}
                  </span>
                ) : null}
              </button>
              {openToolbarMenu === "actions" ? (
                <div role="menu" aria-label="Image actions" className="absolute right-0 top-[calc(100%+0.5rem)] w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
                  <div className="px-3 pb-2 pt-1.5 text-xs font-medium text-muted-foreground">
                    {selectedIds.length > 0
                      ? t("imageRegistry.selectedCount", { count: selectedIds.length })
                      : "Select an image to use these actions"}
                  </div>
                  <ToolbarMenuButton icon={Lightning} label="Generate cards" description="Create flashcards from the preview" disabled={isBusy || !previewAsset} accent="success" onClick={() => {
                    setOpenToolbarMenu(null);
                    void handleGenerateCardsAndAddToDeck();
                  }} />
                  <ToolbarMenuButton icon={Sparkle} label="Describe with AI" description="Analyse the preview image" disabled={isBusy || !previewAsset} onClick={() => {
                    setOpenToolbarMenu(null);
                    void handleDescribePreview();
                  }} />
                  <ToolbarMenuButton testId="create-occlusion-card" icon={FrameCorners} label={t("imageRegistry.createOcclusionCard")} description="Requires exactly one selected image" disabled={isBusy || selectedIds.length !== 1} onClick={() => {
                    setOpenToolbarMenu(null);
                    if (selectedIds.length === 1) dispatchOcclusionRequest(selectedIds[0]);
                  }} />
                  <div className="my-1 border-t border-border/70" />
                  <ToolbarMenuButton icon={Trash} label={t("imageRegistry.deleteSelected")} description="Remove selected images" disabled={isBusy || selectedIds.length === 0} accent="danger" onClick={() => {
                    setOpenToolbarMenu(null);
                    void handleDeleteSelected();
                  }} />
                </div>
              ) : null}
            </div>
            {showCloseButton && onClose && (
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 sm:px-5">
        <label className="relative min-w-0 flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("imageRegistry.searchPlaceholder")}
            className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>

        <label className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 text-sm text-foreground">
          <ArrowsVertical className="h-4 w-4 text-muted-foreground" />
          <span className="hidden text-muted-foreground md:inline">{t("imageRegistry.sortBy")}</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="bg-transparent outline-none"
          >
            <option value="newest">{t("imageRegistry.sortNewest")}</option>
            <option value="oldest">{t("imageRegistry.sortOldest")}</option>
            <option value="name">{t("imageRegistry.sortName")}</option>
            <option value="size">{t("imageRegistry.sortSize")}</option>
          </select>
        </label>

        <div className="hidden rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground sm:block">
          {t("imageRegistry.selectedCount", { count: selectedIds.length })}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-y-auto p-3 sm:p-5">
          {sortedAssets.length === 0 ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-[20px] border border-dashed border-border bg-muted/20 px-6 text-center sm:min-h-[320px] sm:rounded-[24px]">
              <Images className="mb-4 h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground">{t("imageRegistry.emptyTitle")}</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("imageRegistry.emptyDesc")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {sortedAssets.map((asset) => {
                const selected = selectedIds.includes(asset.id);
                const highlighted = highlightedIds.includes(asset.id);
                return (
                  <article
                    key={asset.id}
                    className={cn(
                      "group relative rounded-[22px] border bg-card text-left transition-all",
                      selected ? "border-primary shadow-lg shadow-primary/10 ring-2 ring-primary/20" : "border-border hover:border-primary/40",
                      highlighted && "ring-2 ring-emerald-400/70"
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`${selected ? t("imageRegistry.selected") : t("imageRegistry.select")} ${asset.file_name || t("imageRegistry.untitled")}`}
                      onClick={() => {
                        setPreviewAssetId(asset.id);
                        commitSelectedIds((prev) =>
                          prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]
                        );
                      }}
                      className="block w-full overflow-hidden rounded-[21px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <div className="relative aspect-square overflow-hidden rounded-t-[21px] bg-muted">
                        <img
                          src={asset.data_url}
                          alt={asset.file_name || t("imageRegistry.assetAlt")}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        />
                        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2">
                          {asset.is_referenced ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white">
                              <Link className="h-3 w-3" />
                              {t("imageRegistry.inUse")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">
                              {t("imageRegistry.available")}
                            </span>
                          )}
                          {selected && (
                            <span className="mr-9 rounded-full bg-primary p-1 text-primary-foreground">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2 px-3 py-3">
                        <div className="truncate text-sm font-medium text-foreground">
                          {asset.file_name || t("imageRegistry.untitled")}
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{formatBytes(asset.byte_size)}</span>
                          {asset.width && asset.height ? <span>{asset.width}×{asset.height}</span> : null}
                        </div>
                        {assetTags(asset).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {assetTags(asset).slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                              >
                                #{tag}
                              </span>
                            ))}
                            {assetTags(asset).length > 4 && (
                              <span className="self-center text-[10px] text-muted-foreground">
                                +{assetTags(asset).length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={t("imageRegistry.createOcclusionCard")}
                      title={t("imageRegistry.createOcclusionCardDesc")}
                      onClick={() => dispatchOcclusionRequest(asset.id)}
                      className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white opacity-100 transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    >
                      <FrameCorners className="h-3.5 w-3.5" />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className={cn(
          "min-h-0 flex-col border-l border-border/70 bg-muted/20",
          previewAsset ? "flex" : "hidden lg:flex",
        )}>
          {previewAsset ? (
            <>
              <div className="border-b border-border/70 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {renamingAssetId === previewAsset.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        disabled={renameSaving}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => void commitRenameAsset(previewAsset.id, previewAsset.file_name ?? "")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitRenameAsset(previewAsset.id, previewAsset.file_name ?? "");
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenameAsset();
                          }
                        }}
                        maxLength={200}
                        className="w-full rounded border border-primary/60 bg-background px-1.5 py-0.5 text-sm font-semibold text-foreground outline-none ring-1 ring-primary/30 disabled:opacity-60"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className="cursor-text truncate text-sm font-semibold text-foreground"
                          onDoubleClick={() =>
                            startRenameAsset(previewAsset.id, previewAsset.file_name ?? "")
                          }
                        >
                          {previewAsset.file_name || t("imageRegistry.untitled")}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            startRenameAsset(previewAsset.id, previewAsset.file_name ?? "")
                          }
                          title={t("imageRegistry.rename")}
                          aria-label={t("imageRegistry.rename")}
                          className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <PencilSimple className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {previewAsset.is_referenced
                        ? t("imageRegistry.referenceCount", { count: previewAsset.reference_count || 0 })
                        : t("imageRegistry.notReferenced")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => commitSelectedIds((prev) =>
                      prev.includes(previewAsset.id)
                        ? prev.filter((id) => id !== previewAsset.id)
                        : [...prev, previewAsset.id]
                    )}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                      selectedIds.includes(previewAsset.id)
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-background text-foreground hover:bg-muted"
                    )}
                  >
                    {selectedIds.includes(previewAsset.id) ? t("imageRegistry.selected") : t("imageRegistry.select")}
                  </button>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-border bg-card">
                  <img
                    src={previewAsset.data_url}
                    alt={previewAsset.file_name || t("imageRegistry.assetAlt")}
                    className="h-auto max-h-[280px] w-full object-contain bg-black/5"
                  />
                </div>
              </div>

              <div className="space-y-4 p-4 text-sm">
                <div className="rounded-2xl border border-border bg-background p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    <FrameCorners className="h-3.5 w-3.5" />
                    {t("imageRegistry.details")}
                  </div>
                  <dl className="space-y-2">
                    <MetadataRow label={t("imageRegistry.size")} value={formatBytes(previewAsset.byte_size)} />
                    <MetadataRow label={t("imageRegistry.dimensions")} value={formatDimensions(previewAsset)} />
                    <MetadataRow label={t("imageRegistry.type")} value={previewAsset.mime_type} />
                    <MetadataRow
                      label={t("imageRegistry.added")}
                      value={
                        <span className="inline-flex items-center gap-1">
                          <CalendarBlank className="h-3.5 w-3.5 text-muted-foreground" />
                          {formatDate(previewAsset.created_at)}
                        </span>
                      }
                    />
                  </dl>
                </div>

                <div className="rounded-2xl border border-border bg-background p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {t("imageRegistry.selection")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedAssets.length === 0 ? (
                      <span className="text-sm text-muted-foreground">{t("imageRegistry.noSelection")}</span>
                    ) : (
                      selectedAssets.map((asset) => (
                        <span
                          key={asset.id}
                          className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
                        >
                          <span className="truncate">{asset.file_name || t("imageRegistry.untitled")}</span>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {previewAsset && (
                  <div className="rounded-2xl border border-border bg-background p-3">
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {t("imageRegistry.tags")}
                    </div>
                    <ItemTagEditor
                      target={{
                        type: "image-asset",
                        id: previewAsset.id,
                        tags: assetTags(previewAsset),
                        smartTagDetails: Array.isArray(previewAsset.metadata?.smartTagDetails)
                          ? (previewAsset.metadata.smartTagDetails as import("../../types/document").SmartTagDetail[])
                          : undefined,
                      }}
                      onTagsPersisted={() => {
                        void listImageAssets().then((assets) => {
                          setAssets(Array.isArray(assets) ? assets : []);
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t("imageRegistry.previewEmpty")}
            </div>
          )}
        </aside>
      </div>

      {showConfirmButton && onConfirmSelection ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-4">
          <div className="text-sm text-muted-foreground">
            {t("imageRegistry.selectionHelp")}
          </div>
          <div className="flex items-center gap-2">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                {t("common.cancel")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onConfirmSelection(selectedIds)}
              disabled={selectedIds.length === 0}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {confirmLabel || t("imageRegistry.useSelected")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolbarMenuButton({
  icon: MenuIcon,
  label,
  description,
  onClick,
  disabled = false,
  accent = "default",
  testId,
}: {
  icon: Icon;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "success" | "danger";
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-40",
        accent === "success" && "text-emerald-600 dark:text-emerald-400",
        accent === "danger" && "text-destructive",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/80">
        <MenuIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className={cn(
          "block truncate text-[11px] text-muted-foreground",
          accent !== "default" && "text-current opacity-70",
        )}>
          {description}
        </span>
      </span>
    </button>
  );
}

function MetadataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(asset: ImageAsset) {
  if (!asset.width || !asset.height) return "Unknown";
  return `${asset.width} × ${asset.height}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export default ImageRegistryLibrary;
