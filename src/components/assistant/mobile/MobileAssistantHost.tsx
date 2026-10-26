import { actionStripGeometry } from "./actionStripGeometry";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Sparkle } from "@phosphor-icons/react";
import { useDialogFocus, dialogSurface } from "../../md3/Dialog";
import { highestOverlayPriority, registerOverlayDismissal, subscribeOverlayStack } from "../../../lib/overlayStack";
import { createFeedbackInteractionId, emitUserInteraction } from "../../../lib/feedback/orchestrator";
import { useI18n } from "../../../lib/i18n";
import { useActiveMobileAssistantContext, useMobileAssistantController } from "./MobileAssistantContext";
import { MOBILE_ASSISTANT_CONVERSATION_KEY, type AssistantDetent } from "./contracts";
import { assistantDetentHeight, assistantSheetGeometry, initialAssistantDetent } from "./gesture";
import { useAssistantSheetGesture } from "./useAssistantSheetGesture";
import { AssistantSheetMotion } from "./motion";
import { assistantPillBottom, readAssistantViewport } from "./viewport";
import "./mobile-assistant.css";
import { usePublishBottomControls, visibleControlTop } from "../../mobile/BottomControlsGeometry";
import { subscribeLearningAgentMode } from "../../../lib/ai/assistant/learningAgentHandoff";
const Panel = lazy(() => import("../AssistantPanel").then(module => ({ default: module.AssistantPanel })));

export function MobileAssistantHost({ navRef, audioRef, audioVisible, fullscreen }: { navRef: RefObject<HTMLElement | null>; audioRef?: RefObject<HTMLElement | null>; audioVisible?: boolean; fullscreen: boolean }) {
  const { t } = useI18n();
  const active = useActiveMobileAssistantContext();
  const controller = useMobileAssistantController();
  const [viewport, setViewport] = useState(readAssistantViewport);
  const [navTop, setNavTop] = useState<number>();
  const [singleDetent, setSingleDetent] = useState(false);
  const [actionsSuppressed, setActionsSuppressed] = useState(false);
  const [detent, setDetent] = useState<AssistantDetent>("closed");
  const [preview, setPreview] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [unrelatedInput, setUnrelatedInput] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const preKeyboardDetent = useRef<AssistantDetent | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const currentDetent = useRef(detent);
  const currentPreview = useRef(preview);
  const panelHeight = useRef(0);
  const beganOpen = useRef(0);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.theme === "eink";
  const geometry = useMemo(() => {
    const measured = assistantSheetGeometry(viewport.height - viewport.safeTop - viewport.safeBottom,
      Math.max(320, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 20));
    return singleDetent ? { ...measured, hasPartial: false } : measured;
  }, [viewport, singleDetent]);
  const geometryRef = useRef(geometry); geometryRef.current = geometry;
  const motion = useMemo(() => new AssistantSheetMotion(reveal => {
    surfaceRef.current?.style.setProperty("transform", `translate3d(0, ${panelHeight.current - reveal}px, 0)`);
    if (scrimRef.current) scrimRef.current.style.opacity = String(Math.max(0, Math.min(1, reveal / Math.max(1, geometryRef.current.partial))));
    if (currentDetent.current === "closed") pillRef.current?.style.setProperty("transform", `translate3d(0, ${-Math.max(0, reveal)}px, 0)`);
  }), []);
  const overlayPriority = useSyncExternalStore(subscribeOverlayStack, highestOverlayPriority, () => 0);
  const open = detent !== "closed";
  currentDetent.current = detent; currentPreview.current = preview;
  const available = foreground && !fullscreen && !active.review && !active.registration?.unavailableReason && active.registration?.controlsVisible !== false && !unrelatedInput && overlayPriority <= (open || preview || exiting ? 60 : 0);
  usePublishBottomControls({ viewport, navRef, audioRef, audioVisible, pillRef, pillVisible: available && !open && !exiting && !preview,
    blocked: open || preview || exiting, fullscreen });

  const close = useCallback(() => {
    currentDetent.current = "closed";
    currentPreview.current = false;
    setPreview(false); setDetent("closed");
    setExiting(true);
    motion.settle(0, reducedMotion(), () => { setExiting(false); setCommitted(false); pillRef.current?.style.removeProperty("transform"); });
  }, [motion]);
  // Back/Escape dismissal is owned whenever the sheet is open; Tab
  // containment only while it is modal (expanded/transitioning).
  const dialogRef = useDialogFocus(committed, close, closeRef, {
    priority: 60,
    global: true,
    containFocus: detent === "expanded" || preview,
  });
  const commit = (target: AssistantDetent, id: string, kind: "tap" | "drag" | "handle", force = false) => {
    if (target === "closed") { close(); return; }
    const previous = currentDetent.current;
    if (previous === "closed" && !available && !force) { close(); return; }
    currentDetent.current = target;
    setMounted(true); setCommitted(true); setPreview(false); setExiting(false); setDetent(target);
    currentPreview.current = false;
    beganOpen.current = performance.now();
    panelHeight.current = assistantDetentHeight(target, geometry);
    if (surfaceRef.current) surfaceRef.current.style.height = `${panelHeight.current}px`;
    if (kind === "tap" && previous === "closed") emitUserInteraction("assistant.opened", `${id}:opened`);
    motion.settle(panelHeight.current, reducedMotion(), () => {
      if (kind === "handle" && previous !== "closed" && previous !== target) emitUserInteraction("assistant.detent-settled", `${id}:detent`);
    });
  };
  const onPreview = (reveal: number, armed: boolean) => {
    if (!currentPreview.current && currentDetent.current === "closed") {
      currentPreview.current = true; setPreview(true);
      panelHeight.current = assistantDetentHeight(initialAssistantDetent(geometry), geometry);
      if (surfaceRef.current) surfaceRef.current.style.height = `${panelHeight.current}px`;
    }
    pillRef.current?.setAttribute("data-armed", String(armed));
    motion.drag(reveal);
  };
  const cancel = () => {
    pillRef.current?.removeAttribute("data-armed");
    if (currentDetent.current === "closed") close();
    else motion.settle(assistantDetentHeight(currentDetent.current, geometry), reducedMotion(), () => {});
  };
  const invocation = useAssistantSheetGesture({ kind: "invoke", enabled: available && !open && !exiting, identity: active.ownerKey,
    geometry, detent, onStart: () => { motion.interrupt(); }, onPreview,
    onRelease: commit, onCancel: cancel, onTap: () => commit(initialAssistantDetent(geometry), createFeedbackInteractionId(), "tap") });
  const handle = useAssistantSheetGesture({ kind: "handle", enabled: open && foreground && !fullscreen && overlayPriority <= 60, identity: active.ownerKey,
    geometry, detent, onStart: () => { motion.interrupt(); }, onPreview,
    onRelease: commit, onCancel: cancel, onTap: () => commit(detent === "partial" ? "expanded" : geometry.hasPartial ? "partial" : "closed", createFeedbackInteractionId(), "handle") });

  // Palette "Learning Agent" entry opens this existing sheet without sending a
  // request; the panel consumes the same handoff and selects the mode.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(
    () =>
      subscribeLearningAgentMode((request) => {
        if (!request) return;
        commitRef.current(initialAssistantDetent(geometryRef.current), createFeedbackInteractionId(), "tap", true);
      }),
    []
  );

  useEffect(() => {
    controller?.setDismiss(() => { if (currentDetent.current !== "closed" || currentPreview.current) close(); });
    controller?.setOpen(() => commit(initialAssistantDetent(geometryRef.current), createFeedbackInteractionId(), "tap"));
    return () => { controller?.setOpen(undefined); controller?.setDismiss(undefined); };
  });
  useEffect(() => {
    if ((!preview && !exiting) || committed) return;
    return registerOverlayDismissal(() => { invocation.cancel(); close(); }, { priority: 60, owner: { scope: "global" } });
  }, [preview, exiting, committed]);
  useLayoutEffect(() => {
    const read = () => {
      const next = readAssistantViewport();
      setViewport(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      const bottom = next.top + next.height;
      const nav = visibleControlTop(navRef.current, next.top, bottom);
      const audio = visibleControlTop(audioRef?.current ?? null, next.top, bottom);
      const occupied = Math.min(nav ?? bottom, audio ?? bottom);
      setNavTop(occupied < bottom ? occupied : undefined);
    };
    read();
    const rootObserver = new MutationObserver(read);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    if (navRef.current) rootObserver.observe(navRef.current, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
    if (audioRef?.current) rootObserver.observe(audioRef.current, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
    const resize = new ResizeObserver(read);
    if (navRef.current) resize.observe(navRef.current);
    if (audioRef?.current) resize.observe(audioRef.current);
    return () => { rootObserver.disconnect(); resize.disconnect(); };
  }, [navRef, audioRef, audioVisible, fullscreen]);
  useEffect(() => {
    const visibility = () => { setForeground(!document.hidden); if (document.hidden) { invocation.cancel(); handle.cancel(); } };
    const focus = () => {
      const element = document.activeElement;
      const editable = element instanceof HTMLElement && (element.matches("input,textarea,select") || element.isContentEditable);
      const inSheet = Boolean(editable && surfaceRef.current?.contains(element));
      setUnrelatedInput(Boolean(editable && !inSheet)); setComposerFocused(inSheet);
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", focus);
    return () => { document.removeEventListener("visibilitychange", visibility); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", focus); motion.interrupt(); };
  }, [motion]);
  useEffect(() => {
    if (!open) return;
    if (composerFocused && viewport.keyboardHeight > 80) {
      preKeyboardDetent.current ??= currentDetent.current;
      setDetent("expanded"); currentDetent.current = "expanded";
    } else if (viewport.keyboardHeight < 80 && preKeyboardDetent.current) {
      setDetent(preKeyboardDetent.current); currentDetent.current = preKeyboardDetent.current; preKeyboardDetent.current = null;
    }
    panelHeight.current = assistantDetentHeight(currentDetent.current, geometry);
    motion.settle(panelHeight.current, true, () => {});
  }, [geometry, viewport.keyboardHeight, composerFocused, motion]);
  useEffect(() => {
    if (!open || !mounted) return;
    const measure = () => {
      const surface = surfaceRef.current;
      const composer = surface?.querySelector<HTMLElement>("[data-assistant-composer]");
      const toolbar = surface?.querySelector<HTMLElement>("[data-assistant-toolbar]");
      if (!composer || !toolbar || !surface) return;
      // The conversation must keep at least 96px inside the partial stop; the
      // single-stop fallback only fires for genuinely oversized chrome.
      const strip = surface.querySelector<HTMLElement>('[data-assistant-action-strip]');
      const chrome = composer.offsetHeight + toolbar.offsetHeight + (surface.querySelector<HTMLElement>(".mobile-assistant-sheet-header")?.offsetHeight ?? 0);
      const partial = assistantSheetGeometry(viewport.height - viewport.safeTop - viewport.safeBottom, Math.max(320, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 20)).partial;
      const decision = actionStripGeometry(chrome, strip?.offsetHeight ?? 0, partial, actionsSuppressed);
      if (decision.suppress !== actionsSuppressed) setActionsSuppressed(decision.suppress);
      if (decision.singleDetent) {
        setSingleDetent(true); setDetent("expanded"); currentDetent.current = "expanded";
      } else if (singleDetent) setSingleDetent(false);
    };
    const resize = new ResizeObserver(measure);
    if (surfaceRef.current) resize.observe(surfaceRef.current);
    const composer = surfaceRef.current?.querySelector<HTMLElement>('[data-assistant-composer]');
    if (composer) resize.observe(composer);
    const toolbar = surfaceRef.current?.querySelector<HTMLElement>("[data-assistant-toolbar]");
    if (toolbar) resize.observe(toolbar);
    const observer = new MutationObserver(measure);
    if (surfaceRef.current) observer.observe(surfaceRef.current, { childList: true, subtree: true });
    measure();
    return () => { observer.disconnect(); resize.disconnect(); };
  }, [open, mounted, viewport, actionsSuppressed, singleDetent]);
  useEffect(() => { if (fullscreen && open) close(); }, [fullscreen, open, close]);
  // Modal ownership belongs to the EXPANDED detent only (design D7). A
  // partial sheet is a named nonmodal region: the reader above its bounds
  // keeps receiving pointer input, and the shell is not made inert. During
  // the expand/collapse transition (`exiting`/`preview`) ownership is held so
  // focus cannot escape mid-animation.
  const modalOwned = open && (detent === "expanded" || exiting || preview);
  useEffect(() => {
    if (!modalOwned) return;
    const root = document.querySelector<HTMLElement>(".adaptive-shell-root");
    const previousInert = root?.inert;
    if (root) root.inert = true;
    // Own the shell content lock; higher legacy sheets keep their body lock.
    const content = root?.querySelector<HTMLElement>(".mobile-main-content") ?? root;
    const previousOverflow = content?.style.overflow;
    if (content) content.style.overflow = "hidden";
    return () => { if (root) root.inert = previousInert ?? false; if (content) content.style.overflow = previousOverflow ?? ""; };
  }, [modalOwned]);

  return createPortal(<><div className="mobile-assistant-layer" style={{ top: viewport.top, height: viewport.height }}>
    <div className="mobile-assistant-pill-position" style={{ bottom: assistantPillBottom(viewport, navTop) }}>
      <button ref={pillRef} type="button" className="mobile-assistant-pill md-state" data-gesture-lock
        hidden={!available || open || exiting} aria-expanded={open} aria-controls="mobile-assistant-dialog" {...invocation.bindings}>
        <Sparkle aria-hidden="true" size={20} /><span>{t("assistant.title")}</span>
      </button>
    </div>
    </div><div className="mobile-assistant-overlay" hidden={!open && !preview && !exiting}>
      <div
        ref={scrimRef}
        className="mobile-assistant-scrim"
        aria-hidden="true"
        data-nonmodal={detent !== "expanded" ? "true" : undefined}
        onClick={() => {
          // Only a modal (expanded) scrim dismisses on tap; partial mode passes
          // pointer input through to the reader.
          if (detent === "expanded" && performance.now() - beganOpen.current >= 350) close();
        }}
      />
      <div ref={element => { surfaceRef.current = element; dialogRef.current = element; }} id="mobile-assistant-dialog"
        className={`mobile-assistant-sheet ${dialogSurface}`} style={{ height: panelHeight.current || assistantDetentHeight(initialAssistantDetent(geometry), geometry) }}
        role={committed && detent === "expanded" ? "dialog" : "region"} aria-modal={committed && detent === "expanded" ? true : undefined} aria-labelledby="mobile-assistant-heading" tabIndex={-1} data-gesture-lock>
        {/* One chrome row only: the handle stay; the panel below owns context, scope and close. */}
        <div className="mobile-assistant-sheet-header">
          <button type="button" className="mobile-assistant-handle md-state" aria-label={detent === "partial" ? t("assistant.expandSheet") : t("assistant.collapseSheet")} {...handle.bindings}><span aria-hidden="true" /></button>
          <h2 id="mobile-assistant-heading" className="sr-only">{t("assistant.title")}</h2>
        </div>
        {mounted && <div id="mobile-assistant-chat" className="mobile-assistant-conversation" hidden={!open} inert={!open}>
          <Suspense fallback={<p role="status">Loading Assistant…</p>}><Panel context={active.context} conversationKey={MOBILE_ASSISTANT_CONVERSATION_KEY} mobilePresentation={{
            visible: open,
            actionsSuppressed: actionsSuppressed || viewport.keyboardHeight > 0,
            viewIdentity: `${active.ownerKey}:${detent}`,
            sheet: {
              detent,
              hasPartial: geometry.hasPartial,
              onClose: close,
              onToggleDetent: () => { preKeyboardDetent.current = null; commit(detent === "partial" ? "expanded" : "partial", createFeedbackInteractionId(), "handle"); },
              closeRef,
              source: active.registration ? {
                title: active.registration.context.metadata?.title ?? active.viewLabel,
                removed: active.removed,
                onToggle: active.removed ? active.restore : active.remove,
              } : undefined,
            },
          }} fillContainer appendContextMessages={false} /></Suspense>
        </div>}
      </div>
    </div>
  </>, document.body);
}
