/**
 * Anchored, non-layout-shifting passage suggestion overlay (tasks 4.1/4.2).
 *
 * The marker is absolutely positioned from adapter-projected rectangles, so it
 * reserves no document space and never rewrites source markup. Geometry is
 * refreshed on scroll/resize/zoom inside one animation frame; scoring itself
 * is not triggered by those events. Actions come from the shared selection
 * action registry via a validated source snapshot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkle, X } from "@phosphor-icons/react";
import type { PassageClassification } from "../../../lib/ai/schemas/passageClassification";
import { isExtractWorthinessEligible } from "./identity";
import { useI18n } from "../../../lib/i18n";
import {
  getPassageScoreActions,
  selectionActionLabelKey,
  type PassageActionId,
  type PassageActionSnapshot,
} from "../selectionInteraction/selectionActionRegistry";
import type { PassageProjectedRect } from "./types";

export interface PassageScoreView {
  passageId: string;
  reason: string;
  classification: PassageClassification;
  /** Validated snapshot for actions; null when the source became stale. */
  snapshot: PassageActionSnapshot | null;
}

export interface PassageScoreOverlayProps {
  results: PassageScoreView[];
  projectRects: (passageId: string) => PassageProjectedRect[] | null;
  /** Narrow/mobile readers use the compact edge marker + bottom sheet. */
  narrow?: boolean;
  /** Hide while the controller is detached/suspended/disabled. */
  visible?: boolean;
  openPassageId: string | null;
  onOpen: (passageId: string) => void;
  onClose: () => void;
  onAction: (action: PassageActionId, passageId: string) => void;
  onDismiss: (passageId: string) => void;
  onShowSource: (passageId: string) => void;
  /** Safe localized status/limitation key (quota/authorization/model). */
  statusReasonKey?: string | null;
  canCreateObjects?: boolean;
  learnThisEnabled?: boolean;
  /** Explicit import for ephemeral RSS when a durable action is requested. */
  onImportRequired?: () => void;
  /** The current source has no durable library identity yet. */
  importRequired?: boolean;
}

const MARKER_SIZE = 44;
const MAX_MARKERS = 6;

function useViewportRevision(active: boolean): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let frame: number | null = null;
    const bump = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setRevision((value) => (value + 1) % 1_000_000);
      });
    };
    window.addEventListener("scroll", bump, { capture: true, passive: true });
    window.addEventListener("resize", bump, { passive: true });
    return () => {
      window.removeEventListener("scroll", bump, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", bump);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active]);
  return revision;
}

function markerPosition(rects: PassageProjectedRect[] | null) {
  if (!rects || rects.length === 0) return null;
  const first = rects[0];
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  // Sit in the right gutter just outside the passage, never overlapping the
  // text column where the viewport leaves room.
  const right = Math.min(
    viewportWidth - MARKER_SIZE - 8,
    Math.max(8, first.x + first.width + 4)
  );
  const top = Math.min(
    viewportHeight - MARKER_SIZE - 8,
    Math.max(8, first.y + Math.min(first.height / 2, 28) - MARKER_SIZE / 2)
  );
  return { top, left: right };
}

export function PassageScoreOverlay({
  results,
  projectRects,
  narrow = false,
  visible = true,
  openPassageId,
  onOpen,
  onClose,
  onAction,
  onDismiss,
  onShowSource,
  statusReasonKey,
  canCreateObjects = true,
  learnThisEnabled = true,
  onImportRequired,
  importRequired = false,
}: PassageScoreOverlayProps) {
  const { t } = useI18n();
  const revision = useViewportRevision(visible && results.length > 0);
  const [staleMessage, setStaleMessage] = useState(false);

  const visibleResults = useMemo(
    () => results.filter((result) => isExtractWorthinessEligible(result.classification)).slice(0, MAX_MARKERS),
    [results]
  );
  const open = visibleResults.find((result) => result.passageId === openPassageId) ?? null;

  // One reprojection per animation frame; no layout reads inside render loops.
  const positions = useMemo(() => {
    void revision;
    return visibleResults.map((result) => ({
      result,
      position: markerPosition(projectRects(result.passageId)),
    }));
  }, [visibleResults, projectRects, revision]);

  if (!visible) return null;

  const openActions = open
    ? getPassageScoreActions(open.snapshot, {
        canCreateObjects,
        learnThisEnabled,
      })
    : [];

  return (
    <div
      data-passage-scoring-ui="true"
      data-selection-interaction-ui="true"
      className="pointer-events-none fixed inset-0 z-30"
      aria-live="polite"
    >
      {positions.map(({ result, position }) =>
        position ? (
          <button
            key={result.passageId}
            type="button"
            data-passage-scoring-marker={result.passageId}
            aria-haspopup="dialog"
            aria-expanded={openPassageId === result.passageId}
            aria-label={`${t("ai.passageScoring.indicatorLabel")}: ${result.reason}`}
            title={result.reason}
            onClick={() => onOpen(result.passageId)}
            className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-border/70 bg-card/95 text-amber-600 shadow-md backdrop-blur transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              top: position.top,
              left: position.left,
              width: MARKER_SIZE,
              height: MARKER_SIZE,
              minWidth: MARKER_SIZE,
              minHeight: MARKER_SIZE,
            }}
          >
            <Sparkle className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null
      )}

      {statusReasonKey && visibleResults.length === 0 ? (
        <div
          role="status"
          className="pointer-events-auto absolute bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] left-1/2 max-w-[280px] -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-center text-xs text-muted-foreground shadow-sm"
        >
          {t(statusReasonKey)}
        </div>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t("ai.passageScoring.sheetTitle")}
          data-passage-scoring-sheet="true"
          className={
            narrow
              ? "pointer-events-auto fixed inset-x-0 bottom-0 max-h-[min(70vh,520px)] overflow-y-auto rounded-t-2xl border-t border-border bg-card px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-4 shadow-2xl"
              : "pointer-events-auto fixed bottom-6 right-6 w-[360px] max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl"
          }
        >
          <PassageScoreSheetContent
            key={open.passageId}
            view={open}
            actions={openActions}
            stale={!open.snapshot}
            canImport={Boolean(onImportRequired) && importRequired}
            onAction={(action) => onAction(action, open.passageId)}
            onDismiss={() => onDismiss(open.passageId)}
            onShowSource={() => onShowSource(open.passageId)}
            onImport={() => onImportRequired?.()}
            onClose={() => {
              setStaleMessage(false);
              onClose();
            }}
            staleMessage={staleMessage}
            setStaleMessage={setStaleMessage}
          />
        </div>
      ) : null}
    </div>
  );
}

interface SheetContentProps {
  view: PassageScoreView;
  actions: ReturnType<typeof getPassageScoreActions>;
  stale: boolean;
  canImport: boolean;
  staleMessage: boolean;
  setStaleMessage: (value: boolean) => void;
  onAction: (action: PassageActionId) => void;
  onDismiss: () => void;
  onShowSource: () => void;
  onImport: () => void;
  onClose: () => void;
}

function PassageScoreSheetContent({
  view,
  actions,
  stale,
  canImport,
  staleMessage,
  setStaleMessage,
  onAction,
  onDismiss,
  onShowSource,
  onImport,
  onClose,
}: SheetContentProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    previousFocus.current =
      typeof document !== "undefined" ? document.activeElement : null;
    // Focus the sheet's close control so keyboard users land inside it.
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const previous = previousFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  const runAction = (action: PassageActionId) => {
    if (stale) {
      setStaleMessage(true);
      return;
    }
    if (action === "passageDismiss") {
      onDismiss();
      return;
    }
    onAction(action);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {t("ai.passageScoring.sheetTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("ai.passageScoring.sheetDescription")}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("ai.passageScoring.closeActions")}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{view.reason}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("ai.passageScoring.worthiness")} ·{" "}
        {view.classification.extractWorthiness.toFixed(2)}
      </p>

      {stale ? (
        <div role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-medium">{t("ai.passageScoring.staleSource")}</p>
          <p className="mt-0.5">{t("ai.passageScoring.staleSourceDescription")}</p>
        </div>
      ) : null}
      {staleMessage && !stale ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {t("ai.passageScoring.actionFailed")}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => runAction(action.id as PassageActionId)}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <action.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{t(selectionActionLabelKey(action, "passage"))}</span>
          </button>
        ))}
        {actions.length === 0 && !canImport ? (
          <p className="text-xs text-muted-foreground">
            {t("ai.passageScoring.unavailable")}
          </p>
        ) : null}
        {canImport ? (
          <button
            type="button"
            onClick={onImport}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{t("ai.passageScoring.importArticle")}</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <button
          type="button"
          onClick={onShowSource}
          className="min-h-11 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("ai.passageScoring.showSource")}
        </button>
        {actions.length === 0 ? (
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("ai.passageScoring.dismiss")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
