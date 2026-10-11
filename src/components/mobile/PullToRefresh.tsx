/**
 * Pull to Refresh Component
 *
 * Provides one mobile pull-to-refresh interaction and animation for scrolling
 * containers and same-origin reader frames.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowDown, ArrowsClockwise, Check, WarningCircle } from "@phosphor-icons/react";
import { createFeedbackInteractionId, emitUserInteraction } from "../../lib/feedback/orchestrator";
import { useI18n } from "../../lib/i18n";

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  threshold?: number;
  pullMax?: number;
  refreshDuration?: number;
  children: React.ReactNode;
  className?: string;
}

function isScrollable(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  const overflowY = view.getComputedStyle(element).overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight
  );
}

function findRefreshScrollContainer(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
  boundary: HTMLElement,
): HTMLElement {
  let targetNode = target as Node | null;
  while (targetNode && targetNode.nodeType !== 1) {
    targetNode = targetNode.parentNode;
  }

  let element = targetNode as HTMLElement | null;
  while (element) {
    if (element.hasAttribute("data-scroll-container")) return element;
    if (element !== boundary && isScrollable(element)) return element;
    if (element === boundary) break;
    element = element.parentElement;
  }

  const sourceDocument =
    currentTarget && (currentTarget as Node).nodeType === 9
      ? (currentTarget as Document)
      : targetNode?.ownerDocument ?? boundary.ownerDocument;
  return (sourceDocument.scrollingElement as HTMLElement | null) ?? boundary;
}

export function PullToRefresh({
  onRefresh,
  disabled = false,
  threshold = 80,
  pullMax = 120,
  refreshDuration: _refreshDuration = 2000,
  children,
  className = "",
}: PullToRefreshProps) {
  const { t } = useI18n();
  const [pullDistance, setPullDistance] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  const gestureId = useRef("");
  const armed = useRef(false);
  const distanceRef = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (disabled) return;

    if (e.touches.length === 1 && !refreshing) {
      const scrollContainer = findRefreshScrollContainer(
        e.target,
        e.currentTarget,
        containerRef.current ?? (e.currentTarget as HTMLElement),
      );

      if (scrollContainer.scrollTop <= 0) {
        isDragging.current = true;
        gestureId.current = createFeedbackInteractionId();
        armed.current = false;
        distanceRef.current = 0;
        startY.current = e.touches[0].clientY;
        setPulling(true);
        setPullDistance(0);
      }
    }
  }, [disabled, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || disabled || e.touches.length !== 1) return;

    const deltaY = e.touches[0].clientY - startY.current;
    if (deltaY > 0) {
      const distance = Math.min(deltaY * 0.5, pullMax);
      distanceRef.current = distance;
      setPullDistance(distance);
      if (distance >= threshold && !armed.current) {
        armed.current = true;
        emitUserInteraction("queue.refresh-armed", `${gestureId.current}:armed`);
      }
    } else {
      distanceRef.current = 0;
      setPullDistance(0);
    }
  }, [disabled, pullMax, threshold]);

  const finishRefreshFeedback = useCallback((delay: number) => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setRefreshing(false);
      setPullDistance(0);
      setRefreshSuccess(false);
      setRefreshError(false);
    }, delay);
  }, []);

  const performRefresh = useCallback(async () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    setRefreshing(true);
    setPulling(false);
    setPullDistance(threshold);
    setRefreshSuccess(false);
    setRefreshError(false);

    try {
      await onRefresh();
      setRefreshSuccess(true);
      finishRefreshFeedback(550);
    } catch {
      emitUserInteraction("action.failed", `${gestureId.current}:result`);
      setRefreshError(true);
      finishRefreshFeedback(1300);
    }
  }, [finishRefreshFeedback, onRefresh, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;

    isDragging.current = false;
    armed.current = false;
    setPulling(false);

    if (distanceRef.current >= threshold && !refreshing) {
      void performRefresh();
    } else {
      setPullDistance(0);
    }

    startY.current = 0;
  }, [performRefresh, threshold, refreshing]);

  const cancelPull = useCallback(() => {
    if (!isDragging.current) return;

    isDragging.current = false;
    armed.current = false;
    distanceRef.current = 0;
    startY.current = 0;
    setPulling(false);
    setPullDistance(0);
  }, []);

  useEffect(() => {
    if (disabled) cancelPull();
  }, [disabled, cancelPull]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const listenerOptions: AddEventListenerOptions = { passive: true };
    const frameListeners = new Map<HTMLIFrameElement, { load: EventListener; doc: Document | null }>();

    const detachFrameDocument = (doc: Document) => {
      doc.removeEventListener("touchstart", handleTouchStart);
      doc.removeEventListener("touchmove", handleTouchMove);
      doc.removeEventListener("touchend", handleTouchEnd);
      doc.removeEventListener("touchcancel", cancelPull);
    };

    const attachFrameDocument = (frame: HTMLIFrameElement) => {
      const listener = frameListeners.get(frame);
      if (!listener) return;

      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        // Cross-origin frames cannot participate in the host's pull gesture.
      }

      if (!doc || doc === listener.doc) return;
      if (listener.doc) detachFrameDocument(listener.doc);
      listener.doc = doc;
      doc.addEventListener("touchstart", handleTouchStart, listenerOptions);
      doc.addEventListener("touchmove", handleTouchMove, listenerOptions);
      doc.addEventListener("touchend", handleTouchEnd, listenerOptions);
      doc.addEventListener("touchcancel", cancelPull, listenerOptions);
    };

    const syncFrames = () => {
      const frames = new Set(container.querySelectorAll("iframe"));

      for (const [frame, listener] of frameListeners) {
        if (frames.has(frame)) continue;
        frame.removeEventListener("load", listener.load);
        if (listener.doc) detachFrameDocument(listener.doc);
        frameListeners.delete(frame);
      }

      for (const frame of frames) {
        if (frameListeners.has(frame)) {
          attachFrameDocument(frame);
          continue;
        }
        const listener: { load: EventListener; doc: Document | null } = { load: () => {}, doc: null };
        listener.load = () => attachFrameDocument(frame);
        frameListeners.set(frame, listener);
        frame.addEventListener("load", listener.load);
        attachFrameDocument(frame);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, listenerOptions);
    container.addEventListener("touchmove", handleTouchMove, listenerOptions);
    container.addEventListener("touchend", handleTouchEnd, listenerOptions);
    container.addEventListener("touchcancel", cancelPull, listenerOptions);

    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(syncFrames);
    observer?.observe(container, { childList: true, subtree: true });
    syncFrames();

    return () => {
      observer?.disconnect();
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", cancelPull);
      for (const [frame, listener] of frameListeners) {
        frame.removeEventListener("load", listener.load);
        if (listener.doc) detachFrameDocument(listener.doc);
      }
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [cancelPull, handleTouchEnd, handleTouchMove, handleTouchStart]);

  const progress = Math.min(pullDistance / threshold, 1);
  const progressCircumference = 2 * Math.PI * 13;
  const statusText = refreshing
    ? refreshSuccess
      ? t("mobileRefresh.updated")
      : refreshError
        ? t("mobileRefresh.failed")
        : t("mobileRefresh.refreshing")
    : pullDistance >= threshold
      ? t("mobileRefresh.release")
      : pullDistance > 0
        ? t("mobileRefresh.pull")
        : "";

  return (
    <div
      ref={containerRef}
      className={`touch-gesture-container ${className}`}
      data-scroll-container="true"
    >
      <div
        className={`pull-indicator${pulling ? " dragging" : ""}${refreshing ? " refreshing" : ""}`}
        style={{
          transform: `translateY(${Math.min(pullDistance, pullMax) - 60}px)`,
          opacity: pullDistance > 0 || refreshing ? Math.min(Math.max(progress, 0.35), 1) : 0,
        }}
      >
        <div className="pull-indicator-visual" aria-hidden="true">
          <svg className={`pull-progress-ring${pullDistance >= threshold ? " armed" : ""}`} viewBox="0 0 32 32">
            <circle className="pull-progress-track" cx="16" cy="16" r="13" />
            <circle
              className="pull-progress-value"
              cx="16"
              cy="16"
              r="13"
              strokeDasharray={progressCircumference}
              strokeDashoffset={progressCircumference * (1 - progress)}
            />
          </svg>
          {refreshing ? (
            refreshSuccess ? (
              <Check className="pull-center-icon refresh-icon-success" />
            ) : refreshError ? (
              <WarningCircle className="pull-center-icon refresh-icon-error" />
            ) : (
              <ArrowsClockwise className="pull-center-icon refresh-icon-loading spin" />
            )
          ) : pullDistance >= threshold ? (
            <ArrowsClockwise className="pull-center-icon pull-icon-armed" />
          ) : (
            <ArrowDown className="pull-center-icon pull-icon-arrow" style={{ transform: `rotate(${progress * 180}deg)` }} />
          )}
        </div>
        <span className="pull-status-text bg-card text-foreground border border-border shadow-lg" role="status" aria-live="polite" aria-atomic="true">
          {statusText}
        </span>
      </div>

      {children}
    </div>
  );
}
