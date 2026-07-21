import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchorRect, SPOTLIGHT_PADDING, type AnchorRect } from "./useAnchorRect";
import { TourSpotlight } from "./TourSpotlight";
import { resolveCoachPlacement, type TourPlacement } from "./placement";
import { useFocusTrap } from "./useFocusTrap";
import type { TourAnchorId } from "./anchors";

/**
 * Props for {@link TourOverlay}.
 */
export type TourOverlayProps = {
  /** Candidate anchor IDs for the active step. Empty array = centred card. */
  candidates: TourAnchorId[];
  /** Preferred placement of the coach mark relative to the anchor. */
  placement: TourPlacement;
  /** Step title, used as the dialog's accessible name. */
  title: string;
  /** Optional unique id for the dialog, used to wire aria-labelledby. */
  dialogId: string;
  /** Body content rendered inside the coach mark. */
  children: ReactNode;
  /** Footer controls (Back / Next / Skip). */
  footer: ReactNode;
  /** Optional chapter rail rendered above the body. */
  rail?: ReactNode;
  /** Whether to render the mobile-shell chrome (bottom-sheet placement). */
  isMobileShell?: boolean;
  /** Whether reduced motion is active. */
  reducedMotion?: boolean;
  /**
   * Invoked when the dim region (or a centred-card backdrop) is clicked.
   * The parent decides whether to treat it as a soft dismissal.
   */
  onBackdropClick?: () => void;
  /**
   * Invoked when the user presses Escape while the overlay is mounted.
   */
  onEscape?: () => void;
};

// Fixed coach-mark width on desktop. Mobile uses a wider bottom-sheet style.
const DESKTOP_COACH_WIDTH = 360;
const MOBILE_COACH_WIDTH = 320;

export function TourOverlay({
  candidates,
  placement,
  title,
  dialogId,
  children,
  footer,
  rail,
  isMobileShell = false,
  reducedMotion = false,
  onBackdropClick,
  onEscape,
}: TourOverlayProps) {
  const rect = useAnchorRect(candidates);
  const [viewport, setViewport] = useState(() =>
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 0, height: 0 },
  );

  // Re-measure on viewport changes; the anchor rect hook already tracks
  // element moves, but the placement resolver needs the viewport too.
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Scroll the anchor into view before drawing the spotlight. Runs whenever
  // the candidate set changes (i.e. on step change). See task 3.3.
  useEffect(() => {
    if (candidates.length === 0) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${candidates[0]}"]`);
    if (!el) return;
    // `nearest` avoids scrolling when the element is already partially visible
    // and is well-supported across the three target webviews.
    el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  }, [candidates.join("|"), reducedMotion]);

  const containerRef = useFocusTrap<HTMLDivElement>(true);

  // Measure the coach mark so the placement resolver can flip/shift before
  // the first paint. We measure after mount via useLayoutEffect.
  const [coachSize, setCoachSize] = useState({ width: DESKTOP_COACH_WIDTH, height: 200 });
  const coachElRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!coachElRef.current) return;
    const measured = coachElRef.current.getBoundingClientRect();
    if (measured.width > 0 && measured.height > 0) {
      setCoachSize({ width: measured.width, height: measured.height });
    }
  }, [title, children, rail, isMobileShell]);

  // On mobile, prefer a bottom-sheet placement below the anchor.
  const effectivePlacement: TourPlacement = isMobileShell && placement === "auto" ? "bottom" : placement;
  const coachWidth = isMobileShell ? MOBILE_COACH_WIDTH : DESKTOP_COACH_WIDTH;

  const resolved = resolveCoachPlacement(
    effectivePlacement,
    rect,
    { width: coachSize.width || coachWidth, height: coachSize.height },
    viewport,
  );

  // Escape handling.
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
      }
    };
    // Capture so we beat any other Escape handler (e.g. the reader's own).
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onEscape]);

  if (typeof document === "undefined") return null;

  const transition = reducedMotion
    ? "none"
    : "transform 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease-out";

  return createPortal(
    <div className="tour-root" data-mobile={isMobileShell ? "true" : "false"} aria-live="polite">
      <TourSpotlight rect={rect} onDimClick={onBackdropClick} reducedMotion={reducedMotion} />

      <div
        ref={(node) => {
          containerRef.current = node;
          coachElRef.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${dialogId}-title`}
        aria-describedby={`${dialogId}-desc`}
        tabIndex={-1}
        className="tour-coach"
        style={{
          position: "fixed",
          top: resolved.top,
          left: resolved.left,
          width: coachWidth,
          maxWidth: viewport.width - SPOTLIGHT_PADDING * 2,
          zIndex: 70,
          transition,
          // The centred-card branch (no anchor) should read as a standalone
          // modal; the anchored branch sits beside the spotlight cutout.
          ...(rect ? {} : { boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }),
        }}
      >
        <div className="tour-coach-inner">
          {rail}
          <h2 id={`${dialogId}-title`} className="tour-coach-title">
            {title}
          </h2>
          <div id={`${dialogId}-desc`} className="tour-coach-body">
            {children}
          </div>
          <div className="tour-coach-footer">{footer}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
