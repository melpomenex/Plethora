import type { AssistantDetent, AssistantGesturePhase } from "./contracts";

export interface AssistantSheetGeometry {
  height: number;
  threshold: number;
  partial: number;
  expanded: number;
  hasPartial: boolean;
  detentTravel: number;
}

export function assistantSheetGeometry(height: number, minimumPartial = 320): AssistantSheetGeometry {
  const usable = Math.max(0, Number.isFinite(height) ? height : 0);
  const expanded = Math.max(0, Math.min(0.9 * usable, usable - 8));
  const partial = Math.min(expanded, Math.max(0.45 * usable, minimumPartial));
  return {
    height: usable,
    threshold: Math.min(96, Math.max(64, 0.12 * usable)),
    partial,
    expanded,
    hasPartial: expanded - partial >= 96,
    detentTravel: Math.min(80, 0.15 * usable),
  };
}

export function initialAssistantDetent(geometry: AssistantSheetGeometry): AssistantDetent {
  return geometry.hasPartial ? "partial" : "expanded";
}

export function assistantDetentHeight(detent: AssistantDetent, geometry: AssistantSheetGeometry): number {
  if (detent === "closed") return 0;
  return detent === "partial" && geometry.hasPartial ? geometry.partial : geometry.expanded;
}

export interface InvocationGesture {
  id: string;
  phase: AssistantGesturePhase;
  startX: number;
  startY: number;
  geometry: AssistantSheetGeometry;
  displacement: number;
  reveal: number;
  armed: boolean;
  thresholdAnnounced: boolean;
  tapEligible: boolean;
}

export function beginInvocation(id: string, x: number, y: number, geometry: AssistantSheetGeometry): InvocationGesture {
  return { id, phase: "contact", startX: x, startY: y, geometry: { ...geometry }, displacement: 0, reveal: 0, armed: false, thresholdAnnounced: false, tapEligible: true };
}

/** Pure state transition: effects follow the returned latch transition. */
export function moveInvocation(state: InvocationGesture, x: number, y: number): InvocationGesture {
  if (state.phase === "ended" || state.phase === "rejected") return state;
  const dx = Math.abs(x - state.startX);
  const dy = state.startY - y;
  const distance = Math.max(dx, Math.abs(dy));
  if (state.phase === "contact") {
    if (distance < 8) return state;
    const upward = dy >= 8 && dy >= 1.25 * dx;
    if (!upward) {
      if (dy <= 0 || dx >= Math.abs(dy) || distance >= 16) return { ...state, phase: "rejected" };
      return { ...state, tapEligible: false };
    }
  }
  const displacement = Math.max(0, dy);
  const { threshold, partial, expanded, hasPartial } = state.geometry;
  const initialHeight = hasPartial ? partial : expanded;
  const reveal = Math.min(initialHeight, displacement <= threshold ? displacement : threshold + 0.35 * (displacement - threshold));
  const armed = displacement >= threshold;
  return { ...state, phase: "dragging", tapEligible: false, displacement, reveal, armed, thresholdAnnounced: state.thresholdAnnounced || armed };
}

export function endInvocation(state: InvocationGesture, cancelled = false): { state: InvocationGesture; outcome: "tap" | "open" | "cancel" } {
  const outcome = cancelled || state.phase === "ended" || state.phase === "rejected"
    ? "cancel" : state.phase === "contact" && state.tapEligible ? "tap" : state.armed ? "open" : "cancel";
  return { state: { ...state, phase: "ended", armed: false }, outcome };
}

/** A release advances at most one stop; velocity intentionally has no input. */
export function releaseAssistantHandle(detent: AssistantDetent, upward: number, geometry: AssistantSheetGeometry): AssistantDetent {
  if (detent === "closed") return detent;
  if (upward >= geometry.detentTravel && detent === "partial") return "expanded";
  if (upward <= -geometry.detentTravel) return detent === "expanded" && geometry.hasPartial ? "partial" : "closed";
  return detent;
}

export function assistantHandleReveal(detent: AssistantDetent, upward: number, geometry: AssistantSheetGeometry): number {
  const initial = assistantDetentHeight(detent, geometry);
  const desired = initial + upward;
  const lower = detent === "expanded" && geometry.hasPartial ? geometry.partial : 0;
  if (desired < lower) return lower + 0.2 * (desired - lower);
  if (desired > geometry.expanded) return geometry.expanded + 0.2 * (desired - geometry.expanded);
  return desired;
}
