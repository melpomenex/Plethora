import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, ArrowClockwise, Copy, Trash, X } from "@phosphor-icons/react";
import { getImageAssetById, type ImageAsset } from "../../api/image-registry";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import {
  expandRegionsToCards,
  regionHasUsableArea,
  type OcclusionCardDraft,
  type OcclusionMode,
} from "../../utils/occlusion";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { cn } from "../../utils";
import { useOcclusionSession } from "./useOcclusionSession";
import { useOcclusionSuggestions } from "./useOcclusionSuggestions";
import { useOcclusionAssist } from "./useOcclusionAssist";
import { OcclusionAssistPanel } from "./OcclusionAssistPanel";
import { OcclusionCanvas } from "./OcclusionCanvas";
import { OcclusionRegionList } from "./OcclusionRegionList";
import {
  OcclusionCardPreview,
  type OcclusionPreviewAnswers,
  EMPTY_PREVIEW_ANSWERS,
} from "./OcclusionCardPreview";

/**
 * Full-screen Image Occlusion Composer.
 *
 * The single authoring surface for occlusion cards: portalled to
 * `document.body` so it escapes any hosting stacking context. Holds the whole
 * authoring session internally (regions, suggestions, history, mode) and
 * communicates with callers through a narrow prop contract. Saving emits the
 * card drafts (via the same pure `expandRegionsToCards` the preview uses)
 * plus the usable regions, so a draft-edit caller can write regions back
 * without creating cards.
 */
/** One AI-assist card draft: its own question plus the label regions it hides. */
export interface OcclusionAssistCardDraft {
  question: string;
  answer: string;
  hiddenRegions: ImageOcclusionRegion[];
  visibleRegions: ImageOcclusionRegion[];
}

/** Provenance payload for AI-assist cards (task 3.9; recorded by the host). */
export interface ComposerAssistProvenance {
  taskId: string;
  providerId: string;
  providerKind: "ondevice" | "cloud";
  servedModelClass: string;
  baseModelName?: string;
  fingerprint: string;
  usedFreeform: boolean;
}

export interface ComposerSaveResult {
  assetId: string;
  /** Usable regions (zero-area dropped) as they will be persisted. */
  regions: ImageOcclusionRegion[];
  /** Card drafts the session will produce in the current mode. */
  cards: OcclusionCardDraft[];
  mode: OcclusionMode;
  question: string;
  answers: OcclusionPreviewAnswers;
  documentId?: string;
  deckId?: string;
  /**
   * Accepted AI-assist cards (task 3.6). Each carries its own question and
   * the OCR-box regions it hides; the host creates one learning item per
   * draft and records provenance per created item. Freeform runs have no
   * card drafts here — their regions are `cards` entries whose region ids
   * start with "freeform-".
   */
  assist?: {
    cards: OcclusionAssistCardDraft[];
    provenance: ComposerAssistProvenance;
  };
}

export interface ImageOcclusionComposerProps {
  assetId: string;
  initialRegions?: ImageOcclusionRegion[];
  initialMode?: OcclusionMode;
  documentId?: string;
  deckId?: string;
  onSave: (result: ComposerSaveResult) => void;
  onCancel: () => void;
}

export function ImageOcclusionComposer({
  assetId,
  initialRegions,
  initialMode,
  documentId,
  deckId,
  onSave,
  onCancel,
}: ImageOcclusionComposerProps) {
  const { t } = useI18n();
  const session = useOcclusionSession({ initialRegions, initialMode });
  const { regions, suggestions, selection, mode, apply, undo, redo, canUndo, canRedo, hasChanges } =
    session;

  const [asset, setAsset] = useState<ImageAsset | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [answers, setAnswers] = useState<OcclusionPreviewAnswers>(EMPTY_PREVIEW_ANSWERS);
  const [question, setQuestion] = useState(t("occlusionComposer.defaultQuestion"));
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const ai = useOcclusionSuggestions(asset, session);

  // OCR-backed AI assist (tasks 3.6–3.8): flag- and capability-gated; every
  // failure lands inside the panel, manual authoring is never affected.
  const assistFlagEnabled = useSettingsStore((s) => s.settings.features.aiOcclusionAssist);
  const freeformFlagEnabled = useSettingsStore((s) => s.settings.features.aiOcclusionFreeform);
  const assistAvailability = useAiAvailability("image-prompt");
  const assistEnabled = assistFlagEnabled && assistAvailability.available;
  const assist = useOcclusionAssist(asset, session, {
    freeformEnabled: freeformFlagEnabled,
  });

  // Resizable sidebar: the divider between the canvas and the right panel can
  // be dragged to widen/narrow the panel. Session-local; not part of history.
  // The chosen width persists in localStorage so reopening the composer (or
  // restarting the app) keeps the same panel size.
  const SIDEBAR_MIN_WIDTH = 240;
  const SIDEBAR_MAX_WIDTH = 560;
  const SIDEBAR_DEFAULT_WIDTH = 320;
  const SIDEBAR_WIDTH_STORAGE_KEY = "occlusion-composer-sidebar-width";

  const loadSidebarWidth = useCallback((): number => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
        return parsed;
      }
    } catch {
      // localStorage unavailable (private mode etc.) — fall through to default.
    }
    return SIDEBAR_DEFAULT_WIDTH;
  }, []);

  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const composerBodyRef = useRef<HTMLDivElement>(null);

  const startSidebarResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = composerBodyRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const clampWidth = (width: number) => {
      const max = Math.min(SIDEBAR_MAX_WIDTH, containerRect.width * 0.6);
      return Math.max(SIDEBAR_MIN_WIDTH, Math.min(max, width));
    };
    const onMove = (moveEvent: PointerEvent) => {
      const width = clampWidth(containerRect.right - moveEvent.clientX);
      setSidebarWidth(width);
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
      } catch {
        // Best-effort persistence only.
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    setAssetError(null);
    getImageAssetById(assetId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setAssetError(t("occlusionComposer.assetLoadFailed"));
          return;
        }
        setAsset(loaded);
      })
      .catch(() => {
        if (!cancelled) setAssetError(t("occlusionComposer.assetLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, t]);

  const usableRegions = useMemo(() => regions.filter(regionHasUsableArea), [regions]);
  const cards = useMemo(
    () =>
      expandRegionsToCards(regions, mode, {
        answersByRegionId: answers.byRegionId,
        answer: answers.hideAll,
      }),
    [regions, mode, answers],
  );

  const acceptedAssistCount = assist.acceptedCards.length;

  const handleSave = () => {
    if (usableRegions.length === 0 && acceptedAssistCount === 0) return;
    void (async () => {
      // Source-image staleness (task 3.7): proposals made against a
      // different image hash are dropped, not silently applied.
      const stale = assist.runInfo ? await assist.checkStale() : false;
      const acceptedCards = !stale ? assist.applyAcceptedCardsToSession() : [];
      const assistLabelIds = new Set(acceptedCards.flatMap((card) => card.labelIds));

      const regionsById = new Map(
        (stale ? [] : session.regions).map((region) => [region.id ?? "", region])
      );
      const assistCards: OcclusionAssistCardDraft[] = acceptedCards.flatMap((card) => {
        const hiddenRegions = card.labelIds
          .map(
            (labelId) =>
              regionsById.get(labelId) ??
              assist.labelBoxAsRegion(labelId) ??
              null
          )
          .filter((region): region is ImageOcclusionRegion => region !== null);
        if (hiddenRegions.length === 0) return [];
        return [
          {
            question: card.question.trim() || question.trim(),
            answer: card.answer,
            hiddenRegions,
            visibleRegions: [],
          },
        ];
      });

      // Manual cards cover every region NOT claimed by an assist card.
      const manualRegions = usableRegions.filter(
        (region) => !assistLabelIds.has(region.id ?? "")
      );
      const manualCards = expandRegionsToCards(manualRegions, mode, {
        answersByRegionId: answers.byRegionId,
        answer: answers.hideAll,
      });
      const allCards = [...assistCards, ...manualCards];
      if (allCards.length === 0) return;

      onSave({
        assetId,
        regions: usableRegions,
        cards: allCards,
        mode,
        question: question.trim() || t("occlusionComposer.defaultQuestion"),
        answers,
        documentId,
        deckId,
        assist:
          assist.runInfo && (assistCards.length > 0 || assist.proposals?.usedFreeform)
            ? {
                cards: assistCards,
                provenance: {
                  taskId: assist.runInfo.taskId,
                  providerId: assist.runInfo.providerId,
                  providerKind: assist.runInfo.providerKind,
                  servedModelClass: assist.runInfo.servedModelClass,
                  baseModelName: assist.runInfo.baseModelName,
                  fingerprint: assist.runInfo.fingerprint,
                  usedFreeform: assist.proposals?.usedFreeform ?? false,
                },
              }
            : undefined,
      });
    })();
  };

  const requestClose = useCallback(() => {
    if (hasChanges && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  }, [hasChanges, confirmDiscard, onCancel]);

  // Escape closes (with the unsaved-work confirmation); the canvas swallows
  // Escape while it holds focus (deselect), so this only fires elsewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const handleDuplicate = () => {
    if (selection.length === 0) return;
    apply({ type: "duplicateRegions", ids: selection });
  };

  const handleDelete = () => {
    if (selection.length === 0) return;
    apply({ type: "deleteRegions", ids: selection });
  };

  const aiStatus = (() => {
    switch (ai.status.kind) {
      case "busy":
        return (
          <span className="text-xs text-muted-foreground">{t("occlusionComposer.suggesting")}</span>
        );
      case "dropped": {
        const parts: string[] = [];
        if (ai.status.droppedOutOfBounds > 0) parts.push(t("occlusionComposer.droppedOutOfBounds"));
        if (ai.status.droppedDuplicate > 0) parts.push(t("occlusionComposer.droppedDuplicate"));
        return (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t("occlusionComposer.droppedReport", {
              dropped: ai.status.droppedOutOfBounds + ai.status.droppedDuplicate,
              reason: parts.join(", "),
            })}
          </span>
        );
      }
      case "noUsable":
        return (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {t("occlusionComposer.noUsableProposals")}
          </span>
        );
      case "error":
        return (
          <span className="text-xs text-destructive">
            {t("occlusionComposer.requestFailed")}
            {ai.status.message ? ` ${ai.status.message}` : ""}
          </span>
        );
      default:
        return null;
    }
  })();

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex flex-col bg-background"
      data-testid="occlusion-composer"
      role="dialog"
      aria-modal="true"
      aria-label={t("occlusionComposer.title")}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="truncate text-sm font-semibold text-foreground">
          {asset?.file_name || t("occlusionComposer.title")}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("occlusionComposer.undo")}
            disabled={!canUndo}
            onClick={() => undo()}
            className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowCounterClockwise className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("occlusionComposer.redo")}
            disabled={!canRedo}
            onClick={() => redo()}
            className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-30"
          >
            <ArrowClockwise className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("occlusionComposer.duplicate")}
            disabled={selection.length === 0}
            onClick={handleDuplicate}
            className="rounded-md p-1.5 text-foreground hover:bg-muted disabled:opacity-30"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("occlusionComposer.delete")}
            disabled={selection.length === 0}
            onClick={handleDelete}
            className="rounded-md p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-30"
          >
            <Trash className="h-4 w-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-border" />
          <button
            type="button"
            aria-label={t("occlusionComposer.cancel")}
            onClick={requestClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        ref={composerBodyRef}
        data-testid="occlusion-composer-body"
        className="flex min-h-0 flex-1 flex-col lg:flex-row"
      >
        {/* Canvas */}
        <div className="relative min-h-[40vh] flex-1">
          {assetError ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
              {assetError}
            </div>
          ) : !asset ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("occlusionComposer.loadingAsset")}
            </div>
          ) : (
            <OcclusionCanvas
              asset={asset}
              session={session}
              requestFocusRegionId={focusRequest?.id ?? null}
              requestFocusNonce={focusRequest?.nonce ?? 0}
            />
          )}
          {/* Suggestion count / dropped reporting is rendered by the AI panel (phase 5). */}
          {suggestions.length > 0 && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-emerald-600/90 px-2.5 py-1 text-xs font-medium text-white">
              {t("occlusionComposer.suggestionCount", { count: suggestions.length })}
            </div>
          )}
        </div>

        {/* Resizable divider between canvas and sidebar */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("occlusionComposer.resizePanel")}
          data-testid="occlusion-resize-handle"
          onPointerDown={startSidebarResize}
          className="group hidden w-1.5 shrink-0 cursor-col-resize touch-none select-none items-center justify-center lg:flex"
        >
          <div className="h-16 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-active:bg-primary/70" />
        </div>

        {/* Sidebar */}
        <aside
          className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto border-t border-border p-3 lg:w-[var(--occlusion-sidebar-w)] lg:border-l lg:border-t-0"
          style={{ "--occlusion-sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        >
          {/* Mode selector */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t("occlusionComposer.modeLabel")}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="mode-per-region"
                onClick={() => apply({ type: "setMode", mode: "per-region" })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left",
                  mode === "per-region"
                    ? "border-primary/60 bg-primary/10"
                    : "border-border hover:bg-muted",
                )}
              >
                <span className="block text-xs font-medium text-foreground">
                  {t("occlusionComposer.modePerRegion")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                  {t("occlusionComposer.modePerRegionDesc")}
                </span>
              </button>
              <button
                type="button"
                data-testid="mode-hide-all"
                onClick={() => apply({ type: "setMode", mode: "hide-all" })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left",
                  mode === "hide-all"
                    ? "border-primary/60 bg-primary/10"
                    : "border-border hover:bg-muted",
                )}
              >
                <span className="block text-xs font-medium text-foreground">
                  {t("occlusionComposer.modeHideAll")}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                  {t("occlusionComposer.modeHideAllDesc")}
                </span>
              </button>
            </div>
          </div>

          {/* OCR-backed AI assist (tasks 3.6–3.8), flag + capability gated */}
          {assistEnabled && (
            <OcclusionAssistPanel
              status={assist.status}
              proposals={assist.proposals}
              ocrMeta={assist.ocrMeta}
              isStale={assist.isStale}
              busy={assist.busy}
              freeformEnabled={freeformFlagEnabled}
              onRun={() => void assist.run()}
              onToggleCard={assist.toggleCard}
              onAcceptAll={assist.setAcceptAll}
              onEditCard={assist.editCard}
            />
          )}

          {/* AI suggestions */}
          <div className="flex flex-col gap-1.5" data-testid="ai-suggest-panel">
            <span className="text-xs font-medium text-muted-foreground">
              {t("occlusionComposer.aiLabel")}
            </span>
            {!ai.visionProvider ? (
              <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {t("occlusionComposer.noVisionModel")}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  data-testid="suggest-regions"
                  disabled={ai.isSuggesting}
                  onClick={() => void ai.suggest()}
                  className="rounded-md bg-emerald-600/90 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("occlusionComposer.suggestRegions")}
                </button>
                <input
                  value={ai.hint}
                  onChange={(event) => ai.setHint(event.target.value)}
                  placeholder={t("occlusionComposer.refineHintPlaceholder")}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  data-testid="refine-suggestions"
                  disabled={ai.isSuggesting}
                  onClick={() => void ai.suggest(ai.hint)}
                  className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("occlusionComposer.refine")}
                </button>
                {suggestions.length > 0 && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      data-testid="accept-all-suggestions"
                      onClick={() => apply({ type: "acceptAllSuggestions" })}
                      className="flex-1 rounded-md bg-emerald-600/15 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-600/25 dark:text-emerald-400"
                    >
                      {t("occlusionComposer.acceptAll")}
                    </button>
                    <button
                      type="button"
                      data-testid="reject-all-suggestions"
                      onClick={() => apply({ type: "rejectAllSuggestions" })}
                      className="flex-1 rounded-md bg-rose-600/15 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-600/25 dark:text-rose-400"
                    >
                      {t("occlusionComposer.rejectAll")}
                    </button>
                  </div>
                )}
              </div>
            )}
            {aiStatus}
          </div>

          {/* Region list */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("occlusionComposer.regionListTitle")}
            </span>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OcclusionRegionList
                session={session}
                onRequestFocusRegion={(id) => setFocusRequest({ id, nonce: Date.now() })}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("occlusionComposer.previewLabel")}
            </span>
            <OcclusionCardPreview
              asset={asset}
              regions={regions}
              mode={mode}
              answers={answers}
              onAnswersChange={setAnswers}
            />
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="flex items-center gap-3 border-t border-border px-4 py-2.5">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t("occlusionComposer.questionLabel")}</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("occlusionComposer.questionPlaceholder")}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </label>
        <button
          type="button"
          onClick={requestClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("occlusionComposer.cancel")}
        </button>
        <button
          type="button"
          data-testid="occlusion-save"
          disabled={usableRegions.length === 0 && acceptedAssistCount === 0}
          onClick={handleSave}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("occlusionComposer.saveCards", { count: cards.length + acceptedAssistCount })}
        </button>
      </footer>

      {usableRegions.length === 0 && (
        <p className="border-t border-border px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          {t("occlusionComposer.atLeastOneRegion")}
        </p>
      )}

      {/* Unsaved-work confirmation */}
      {confirmDiscard && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">
              {t("occlusionComposer.discardConfirmTitle")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("occlusionComposer.discardConfirmDesc")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                {t("occlusionComposer.discardKeepEditing")}
              </button>
              <button
                type="button"
                data-testid="discard-confirm"
                onClick={() => onCancel()}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:opacity-90"
              >
                {t("occlusionComposer.discardDiscard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
