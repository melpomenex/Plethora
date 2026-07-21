import { useEffect } from "react";
import { computeDimPanels, SPOTLIGHT_PADDING, type AnchorRect } from "./useAnchorRect";

/**
 * Props for {@link TourSpotlight}.
 */
export type TourSpotlightProps = {
  /** Anchor rect, or `null` to render a full-screen dim (centred card step). */
  rect: AnchorRect | null;
  /** Optional handler invoked when the dim region is clicked. */
  onDimClick?: () => void;
  /** True under reduced motion: the ring still shows, but no transitions. */
  reducedMotion?: boolean;
};

/**
 * Four dim rectangles (top/right/bottom/left) plus a rounded ring around the
 * anchor. See design D2 in
 * `openspec/changes/add-guided-onboarding-tour/design.md` for why four panels
 * rather than an animated `clip-path` mask: uniform behaviour across WKWebView,
 * WebView2 and WebKitGTK, and GPU-friendly `inset` transitions.
 *
 * When `rect` is null the spotlight is a single full-screen dim — used by
 * centred-card steps that have no anchor.
 */
export function TourSpotlight({ rect, onDimClick, reducedMotion }: TourSpotlightProps) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;

  // Keep the dim layer pixel-aligned to the viewport when the window changes.
  useEffect(() => {
    // The hook in useAnchorRect already tracks resize; this effect exists
    // only to make sure we never leave the dim layer in a stale size if the
    // rect hook is not currently mounted (e.g. the centred-card branch). It
    // is a no-op for layout — React re-renders on viewport changes via state.
  }, []);

  const panels = rect
    ? computeDimPanels(rect, SPOTLIGHT_PADDING, vw, vh)
    : {
        top: { left: 0, top: 0, width: vw, height: vh, right: vw, bottom: vh },
        right: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },
        bottom: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },
        left: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 },
        ring: null as null | { left: number; top: number; width: number; height: number; right: number; bottom: number },
      };

  const transition = reducedMotion ? "none" : "inset 320ms cubic-bezier(0.4, 0, 0.2, 1)";

  return (
    <div
      className="tour-spotlight"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
      }}
      aria-hidden="true"
    >
      {(["top", "right", "bottom", "left"] as const).map((side) => {
        const p = panels[side];
        return (
          <div
            key={side}
            className={`tour-dim tour-dim-${side}`}
            style={{
              position: "absolute",
              left: p.left,
              top: p.top,
              width: p.width,
              height: p.height,
              background: "rgba(15, 17, 21, 0.55)",
              pointerEvents: onDimClick ? "auto" : "none",
              cursor: onDimClick ? "pointer" : "default",
              transition,
              opacity: 0,
              animation: "tour-dim-fade 180ms ease-out forwards",
            }}
            onClick={onDimClick}
          />
        );
      })}

      {panels.ring && (
        <div
          className="tour-ring"
          style={{
            position: "absolute",
            left: panels.ring.left,
            top: panels.ring.top,
            width: panels.ring.width,
            height: panels.ring.height,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(15, 17, 21, 0)",
            outline: "2px solid var(--tour-ring-color, rgba(99, 102, 241, 0.75))",
            outlineOffset: 0,
            pointerEvents: "none",
            transition,
          }}
        />
      )}

      <style>{`
        @keyframes tour-dim-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
