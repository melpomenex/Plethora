import type { TourAnimationKind } from "./types";

/**
 * A small inline-SVG illustration for a tour step. Pure CSS keyframes, no
 * animation library, no video assets (design D10 third tier). The animation
 * kind is chosen by the step definition.
 *
 * Under reduced motion the CSS attribute selector
 * `:root[data-reduced-motion="true"] .tour-illustration *` flattens every
 * animation below, so this component does not need to read the
 * reduced-motion flag itself.
 */
export function TourIllustration({ kind }: { kind: TourAnimationKind }) {
  if (kind === "none") return null;

  const animationName =
    kind === "card"
      ? "tour-illustrate-card"
      : kind === "lift"
      ? "tour-illustrate-lift"
      : "tour-illustrate-pulse";

  return (
    <div className="tour-illustration" aria-hidden="true">
      <svg
        width="120"
        height="80"
        viewBox="0 0 120 80"
        style={{
          animation: `${animationName} 2400ms ${kind === "card" ? "steps(1, end)" : "ease-in-out"} infinite`,
          transformOrigin: "center",
        }}
      >
        {kind === "card" && <CardFrame />}
        {kind === "lift" && <LiftFrame />}
        {kind === "pulse" && <PulseFrame />}
      </svg>
    </div>
  );
}

function CardFrame() {
  return (
    <g>
      <rect x="35" y="15" width="50" height="50" rx="6" fill="var(--tour-accent)" opacity="0.85" />
      <rect x="42" y="22" width="36" height="6" rx="2" fill="var(--tour-accent-fg)" opacity="0.9" />
      <rect x="42" y="34" width="28" height="4" rx="2" fill="var(--tour-accent-fg)" opacity="0.7" />
      <rect x="42" y="44" width="32" height="4" rx="2" fill="var(--tour-accent-fg)" opacity="0.7" />
    </g>
  );
}

function LiftFrame() {
  return (
    <g>
      <rect x="25" y="40" width="70" height="24" rx="4" fill="var(--tour-muted)" opacity="0.35" />
      <rect x="40" y="20" width="40" height="28" rx="4" fill="var(--tour-accent)" opacity="0.85" />
      <rect x="48" y="28" width="24" height="4" rx="2" fill="var(--tour-accent-fg)" opacity="0.9" />
      <rect x="48" y="36" width="18" height="4" rx="2" fill="var(--tour-accent-fg)" opacity="0.7" />
    </g>
  );
}

function PulseFrame() {
  return (
    <g>
      <circle cx="60" cy="40" r="22" fill="var(--tour-accent)" opacity="0.85" />
      <circle cx="60" cy="40" r="10" fill="var(--tour-accent-fg)" opacity="0.9" />
    </g>
  );
}
