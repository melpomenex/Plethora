import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createFeedbackInteractionId, emitUserInteraction } from "../../../lib/feedback/orchestrator";
import { assistantHandleReveal, beginInvocation, endInvocation, moveInvocation, releaseAssistantHandle, type AssistantSheetGeometry, type InvocationGesture } from "./gesture";
import type { AssistantDetent } from "./contracts";

interface GestureOptions {
  kind: "invoke" | "handle";
  enabled: boolean;
  identity: string;
  geometry: AssistantSheetGeometry;
  detent: AssistantDetent;
  onStart: () => void;
  onPreview: (reveal: number, armed: boolean) => void;
  onRelease: (detent: AssistantDetent, id: string, kind: "drag" | "handle") => void;
  onCancel: () => void;
  onTap: () => void;
}
interface Contact { pointerId: number; element: HTMLElement; gesture: InvocationGesture; detent: AssistantDetent; captured: boolean }

/** Only bindings on the visible pill/handle can create a contact. */
export function useAssistantSheetGesture(options: GestureOptions) {
  const latest = useRef(options);
  latest.current = options;
  const contact = useRef<Contact | null>(null);
  const suppressClick = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const releaseCapture = (current: Contact) => {
    if (current.captured && current.element.hasPointerCapture?.(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  const cancel = () => {
    const current = contact.current;
    if (!current) return;
    contact.current = null;
    suppressClick.current = true;
    releaseCapture(current);
    latest.current.onCancel();
  };
  cancelRef.current = cancel;
  useEffect(() => {
    cancelRef.current();
  }, [options.enabled, options.identity, options.geometry.height, options.geometry.partial, options.geometry.expanded]);
  useEffect(() => {
    const cancelContact = () => cancelRef.current();
    const hidden = () => { if (document.hidden) cancelContact(); };
    // Terminal monitoring only: outside contacts can cancel, never recognize.
    const additionalContact = (event: PointerEvent) => {
      if (contact.current && event.pointerId !== contact.current.pointerId) cancelContact();
    };
    window.addEventListener("blur", cancelContact);
    window.addEventListener("pagehide", cancelContact);
    window.addEventListener("pointerdown", additionalContact, { passive: true });
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", cancelContact);
      window.removeEventListener("pagehide", cancelContact);
      window.removeEventListener("pointerdown", additionalContact);
      document.removeEventListener("visibilitychange", hidden);
      cancelContact();
    };
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (contact.current) { cancel(); return; }
    if (!latest.current.enabled || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    contact.current = { pointerId: event.pointerId, element: event.currentTarget, captured: false, detent: latest.current.detent,
      gesture: beginInvocation(createFeedbackInteractionId(), event.clientX, event.clientY, latest.current.geometry) };
    latest.current.onStart();
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = contact.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const old = current.gesture;
    if (latest.current.kind === "handle") {
      const up = old.startY - event.clientY;
      if (Math.max(Math.abs(up), Math.abs(event.clientX - old.startX)) < 8 && !current.captured) return;
      if (!current.captured && Math.abs(up) < 1.25 * Math.abs(event.clientX - old.startX)) { cancel(); return; }
      current.gesture = { ...old, phase: "dragging", tapEligible: false, displacement: up };
      latest.current.onPreview(assistantHandleReveal(current.detent, up, old.geometry), false);
    } else {
      current.gesture = moveInvocation(old, event.clientX, event.clientY);
      if (current.gesture.phase !== "contact") suppressClick.current = true;
      if (current.gesture.phase !== "dragging") return;
      latest.current.onPreview(current.gesture.reveal, current.gesture.armed);
      if (current.gesture.thresholdAnnounced && !old.thresholdAnnounced) emitUserInteraction("assistant.invoke-armed", `${old.id}:armed`);
    }
    suppressClick.current = true;
    if (!current.captured) {
      try { current.element.setPointerCapture(event.pointerId); current.captured = true; }
      catch { cancel(); return; }
    }
    event.preventDefault();
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (contact.current?.pointerId !== event.pointerId) return;
    move(event); // Release uses current coordinates, never the last move frame.
    const current = contact.current;
    if (!current) return;
    contact.current = null;
    releaseCapture(current);
    if (latest.current.kind === "handle") {
      if (!current.captured) return;
      const target = releaseAssistantHandle(current.detent, current.gesture.displacement, current.gesture.geometry);
      latest.current.onRelease(target, current.gesture.id, "handle");
    } else {
      const { outcome } = endInvocation(current.gesture);
      if (outcome === "tap") return; // Native click includes keyboard/AT support.
      suppressClick.current = true;
      if (outcome === "open") latest.current.onRelease(current.gesture.geometry.hasPartial ? "partial" : "expanded", current.gesture.id, "drag");
      else latest.current.onCancel();
    }
  };
  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.detail !== 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); return; }
    if (latest.current.enabled) latest.current.onTap();
  };
  return { cancel, bindings: { onPointerDown, onPointerMove: move, onPointerUp, onPointerCancel: cancel,
    onLostPointerCapture: cancel, onPointerLeave: () => { if (contact.current && !contact.current.captured) cancel(); }, onClick } };
}
