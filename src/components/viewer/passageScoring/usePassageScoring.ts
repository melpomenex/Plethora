/**
 * React binding for passage scoring (task 4.x).
 *
 * Owns exactly one controller/adapter per active reader revision and maps
 * controller results to registry-driven actions. Host surfaces supply the
 * adapter and the existing extract/card/cloze/highlight handlers; this hook
 * never synthesizes DOM selection events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeatureReadiness } from "../../../lib/ai/features/useFeatureReadiness";
import type { PassageClassification } from "../../../lib/ai/schemas/passageClassification";
import {
  PassageScoringController,
  type PassageScoringControllerDeps,
} from "./controller";
import { createPassageScoringDeps } from "./deps";
import {
  emptyPassageScoringCounters,
  type StoredPassageScore,
} from "./cache";
import {
  getPassageScoreActions,
  isValidPassageActionSnapshot,
  type PassageActionId,
  type PassageActionSnapshot,
} from "../selectionInteraction/selectionActionRegistry";
import type {
  PassageAdapter,
  PassageLocator,
  PassageSnapshot,
  PassageScoringCounters,
  PassageScoringResult,
  PassageScoringStatus,
} from "./types";
import type { PassageScoreView } from "./PassageScoreOverlay";

export interface PassageActionContext {
  snapshot: PassageSnapshot;
  actionSnapshot: PassageActionSnapshot;
  text: string;
  reason: string;
  classification: PassageClassification;
}

export interface PassageActionHandlers {
  createExtract?: (context: PassageActionContext) => void | Promise<void>;
  createFlashcard?: (context: PassageActionContext) => void | Promise<void>;
  createCloze?: (context: PassageActionContext) => void | Promise<void>;
  learnThis?: (context: PassageActionContext) => void | Promise<void>;
  highlight?: (context: PassageActionContext) => void | Promise<void>;
  showSource?: (locator: PassageLocator, snapshot: PassageSnapshot) => void;
  canCreateObjects?: boolean;
  learnThisEnabled?: boolean;
  /** Explicit import for an ephemeral RSS article. */
  onImportRequired?: () => void;
}

export interface UsePassageScoringOptions {
  documentId?: string;
  documentTitle?: string;
  /** Source revision: edits change it, reflow/zoom do not. */
  sourceRevision: string;
  /** Returns the adapter for the current mounted reader surface. */
  adapterFactory: () => PassageAdapter | null;
  /** Change to rebuild the adapter/controller (e.g. mode, roots, iframe). */
  adapterKey: string;
  /** Active-tab state from the reader host. */
  isForeground: boolean;
  /** Host feature flag (already persisted in Settings). */
  featureEnabled: boolean;
  /** Durable dismissal persistence requires a real library document id. */
  durable?: boolean;
  handlers?: PassageActionHandlers;
  /** Dependency injection for tests. */
  depsFactory?: () => PassageScoringControllerDeps;
  /** Disable readiness gating (tests / explicitly-scoped surfaces). */
  skipReadinessGate?: boolean;
}

export interface UsePassageScoringResult {
  results: PassageScoreView[];
  counters: PassageScoringCounters;
  status: PassageScoringStatus;
  statusReasonKey: string | null;
  visible: boolean;
  openPassageId: string | null;
  openSuggestion: (passageId: string) => void;
  closeSuggestion: () => void;
  dismiss: (passageId: string) => Promise<void>;
  projectRects: (passageId: string) => import("./types").PassageProjectedRect[] | null;
  showSource: (passageId: string) => void;
  /** Scroll/selection/reflow activity; reflow aborts in-flight work. */
  noteActivity: (kind?: "scroll" | "selection" | "reflow") => void;
  performAction: (action: PassageActionId, passageId: string) => Promise<void>;
}

export function usePassageScoring(
  options: UsePassageScoringOptions
): UsePassageScoringResult {
  const {
    documentId,
    documentTitle,
    sourceRevision,
    adapterFactory,
    adapterKey,
    isForeground,
    featureEnabled,
    durable,
    handlers,
    depsFactory,
    skipReadinessGate = false,
  } = options;

  const readiness = useFeatureReadiness(skipReadinessGate ? undefined : "extract-worthiness");
  const readinessRow = skipReadinessGate ? null : readiness.rows[0] ?? null;
  const readinessReady = skipReadinessGate ? true : readinessRow?.status === "ready";
  const enabled = featureEnabled && readinessReady;
  const readinessReasonKey =
    featureEnabled &&
    !skipReadinessGate &&
    readinessRow &&
    (readinessRow.status === "setup-required" ||
      readinessRow.status === "model-download-required" ||
      readinessRow.status === "unavailable-platform" ||
      readinessRow.status === "error")
      ? "ai.passageScoring.unavailableModel"
      : null;
  const configRevision = skipReadinessGate ? "" : readiness.revision;

  const controllerRef = useRef<PassageScoringController | null>(null);
  const visitKeyRef = useRef<string | null>(null);
  const [resultMap, setResultMap] = useState<Map<string, PassageScoringResult>>(
    () => new Map()
  );
  const [counters, setCounters] = useState<PassageScoringCounters>(
    emptyPassageScoringCounters()
  );
  const [status, setStatus] = useState<PassageScoringStatus>("idle");
  const [statusReasonKey, setStatusReasonKey] = useState<string | null>(null);
  const [openPassageId, setOpenPassageId] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden"
  );

  const foregroundRef = useRef(isForeground);
  foregroundRef.current = isForeground;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () =>
      setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (featureEnabled) return;

    setStatusReasonKey(null);
    setStatus("disabled");
    setResultMap(new Map());
    setOpenPassageId(null);
  }, [featureEnabled]);

  // Build one controller per active adapter/revision. Cleanup disposes the
  // adapter and clears indicators immediately.
  useEffect(() => {
    if (!enabled || !sourceRevision) return;
    const adapter = adapterFactory();
    if (!adapter) return;

    const deps = (depsFactory ?? (() => createPassageScoringDeps({
      documentId,
      documentTitle,
      sourceRevision,
      durable,
    })))();

    const controller = new PassageScoringController({
      adapter,
      documentId,
      documentTitle,
      sourceRevision,
      isForeground: () => foregroundRef.current,
      isEnabled: () => enabledRef.current,
      getConfigRevision: () => configRevision,
      deps,
      events: {
        onResult: (result) => {
          setResultMap((previous) => {
            const next = new Map(previous);
            next.set(result.passageId, result);
            return next;
          });
          setStatus("idle");
        },
        onRemove: (passageId) => {
          setResultMap((previous) => {
            if (!previous.has(passageId)) return previous;
            const next = new Map(previous);
            next.delete(passageId);
            return next;
          });
          setOpenPassageId((current) => (current === passageId ? null : current));
        },
        onClear: () => {
          setResultMap(new Map());
          setOpenPassageId(null);
        },
        onCounters: setCounters,
        onStatus: (nextStatus, reasonKey) => {
          setStatus(nextStatus);
          setStatusReasonKey(reasonKey ?? null);
        },
      },
    });
    // Reset the per-visit inference cap only when the document/source visit
    // actually changes — adapter rebuilds (zoom, page mount) must not refill it.
    const visitKey = `${documentId ?? ""}:${sourceRevision}`;
    if (visitKeyRef.current !== visitKey) {
      visitKeyRef.current = visitKey;
      controller.startVisit();
    }
    controllerRef.current = controller;
    controller.start();
    if (!documentVisible) controller.setForeground(false);

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      setResultMap(new Map());
      setOpenPassageId(null);
    };
  }, [
    enabled,
    sourceRevision,
    adapterKey,
    documentId,
    documentTitle,
    durable,
    configRevision,
    depsFactory,
  ]);

  const foreground = isForeground && documentVisible;
  useEffect(() => {
    controllerRef.current?.setForeground(foreground);
  }, [foreground]);

  const results = useMemo<PassageScoreView[]>(() => {
    const controller = controllerRef.current;
    if (!controller) return [];
    const views: PassageScoreView[] = [];
    for (const result of resultMap.values()) {
      const snapshot = controller.snapshot(result.passageId);
      const actionSnapshot: PassageActionSnapshot | null =
        snapshot && snapshot.contentHash === result.contentHash
          ? {
              ownerToken: snapshot.ownerToken,
              documentId: snapshot.documentId,
              sourceRevision: snapshot.sourceRevision,
              passageId: snapshot.passageId,
              contentHash: snapshot.contentHash,
            }
          : null;
      views.push({
        passageId: result.passageId,
        reason: result.reason,
        classification: result.classification,
        snapshot: isValidPassageActionSnapshot(actionSnapshot) ? actionSnapshot : null,
      });
    }
    return views;
  }, [resultMap, counters]);

  const projectRects = useCallback((passageId: string) => {
    return controllerRef.current?.projectRects(passageId) ?? null;
  }, []);

  const openSuggestion = useCallback((passageId: string) => {
    setOpenPassageId(passageId);
  }, []);
  const closeSuggestion = useCallback(() => setOpenPassageId(null), []);

  const dismiss = useCallback(async (passageId: string) => {
    await controllerRef.current?.dismiss(passageId);
    setOpenPassageId((current) => (current === passageId ? null : current));
  }, []);

  const performAction = useCallback(
    async (action: PassageActionId, passageId: string) => {
      const controller = controllerRef.current;
      if (!controller) return;
      const snapshot = controller.snapshot(passageId);
      const result = resultMap.get(passageId);
      if (!snapshot || !result || snapshot.contentHash !== result.contentHash) {
        setOpenPassageId(null);
        return;
      }
      const actionSnapshot: PassageActionSnapshot = {
        ownerToken: snapshot.ownerToken,
        documentId: snapshot.documentId,
        sourceRevision: snapshot.sourceRevision,
        passageId: snapshot.passageId,
        contentHash: snapshot.contentHash,
      };
      if (!isValidPassageActionSnapshot(actionSnapshot)) return;
      const context: PassageActionContext = {
        snapshot,
        actionSnapshot,
        text: snapshot.text,
        reason: result.reason,
        classification: result.classification,
      };
      const active = handlersRef.current;
      switch (action) {
        case "passageExtract":
          await active?.createExtract?.(context);
          break;
        case "passageFlashcard":
          await active?.createFlashcard?.(context);
          break;
        case "passageCloze":
          await active?.createCloze?.(context);
          break;
        case "passageLearnThis":
          await active?.learnThis?.(context);
          break;
        case "passageHighlight":
          await active?.highlight?.(context);
          break;
        case "passageDismiss":
          await controller.dismiss(passageId);
          break;
      }
      setOpenPassageId(null);
    },
    [resultMap]
  );

  const showSource = useCallback((passageId: string) => {
    const controller = controllerRef.current;
    const snapshot = controller?.snapshot(passageId);
    if (!controller || !snapshot) return;
    if (controller.resolveLocator(snapshot.locator)) {
      handlersRef.current?.showSource?.(snapshot.locator, snapshot);
    }
  }, []);

  // The overlay calls `onShowSource` with a passage id; keep that routing here.
  return {
    results,
    counters,
    status,
    statusReasonKey: featureEnabled ? (statusReasonKey ?? readinessReasonKey) : null,
    visible:
      featureEnabled &&
      foreground &&
      (results.length > 0 || Boolean(statusReasonKey) || Boolean(readinessReasonKey)),
    openPassageId,
    openSuggestion,
    closeSuggestion,
    dismiss,
    projectRects,
    showSource,
    noteActivity: (kind = "scroll") => controllerRef.current?.noteActivity(kind),
    performAction,
  };
}

/** Registry action ids for the current validated view (hosts/tests). */
export function passageActionsForView(
  view: PassageScoreView | null,
  canCreateObjects = true,
  learnThisEnabled = true
) {
  return getPassageScoreActions(view?.snapshot, { canCreateObjects, learnThisEnabled });
}

/** Test helper: seed a stored cache row without touching Tauri. */
export function toStoredPassageScore(
  result: PassageScoringResult
): StoredPassageScore {
  return {
    chunkHash: result.contentHash,
    passageType: result.classification.type,
    extractWorthiness: result.classification.extractWorthiness,
    suggestedAction: result.classification.suggestedLearningAction,
    model: result.modelRevision,
    reason: result.reason,
    classifierVersion: result.classifierVersion,
    modelRevision: result.modelRevision,
    normalizationVersion: "passage-normalization-v1",
    createdAt: result.createdAt ?? "",
  };
}
