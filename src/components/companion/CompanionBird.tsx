/**
 * CompanionBird — the Plethora mascot ("Friendly Chirp", the P-shaped bird
 * from assets/brand/plethora-icon-master.svg) as an inline SVG with
 * CSS-transform state animations.
 *
 * Design constraints (spec: companion-presentation):
 *  - CSS transforms/keyframes only; no rAF loop, no JS-driven per-frame state
 *  - `prefers-reduced-motion` / presentation `reducedMotion` renders static
 *  - decorative: aria-hidden (speech bubbles carry their own a11y semantics)
 */

import { cn } from "../../utils";
import type { CompanionStateId } from "../../lib/companion/types";

interface CompanionBirdProps {
  state: CompanionStateId;
  reducedMotion: boolean;
  className?: string;
}

export function CompanionBird({ state, reducedMotion, className }: CompanionBirdProps) {
  const animated = !reducedMotion && state !== "sleep";
  // Reduced motion: only a static perch pose (and blink is skipped entirely).
  const pose = reducedMotion ? "perch" : state;

  return (
    <div
      aria-hidden="true"
      className={cn("companion-bird select-none pointer-events-none", className)}
      data-companion-state={pose}
    >
      <svg
        width="72"
        height="72"
        viewBox="0 0 1024 1024"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="companion-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="55%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#5B21B6" />
          </linearGradient>
        </defs>
        {/* Tail — the ascender stroke of the "P" silhouette */}
        <path
          className="companion-tail"
          d="M232 664 C150 690 118 756 128 830 C220 806 286 758 318 692 Z"
          fill="url(#companion-body)"
        />
        {/* Body — the bowl of the "P" */}
        <ellipse
          className="companion-body"
          cx="430"
          cy="560"
          rx="250"
          ry="230"
          fill="url(#companion-body)"
        />
        {/* Head */}
        <circle className="companion-head" cx="620" cy="330" r="150" fill="url(#companion-body)" />
        {/* Beak */}
        <path className="companion-beak" d="M756 330 L872 366 L756 402 Z" fill="#F59E0B" />
        {/* Eye */}
        <g className="companion-eye">
          <circle cx="668" cy="300" r="30" fill="#FFFFFF" />
          <circle className="companion-pupil" cx="676" cy="302" r="14" fill="#1E1B4B" />
        </g>
        {/* Wing */}
        <path
          className="companion-wing"
          d="M380 480 C500 420 640 440 700 520 C640 610 500 640 380 600 C350 560 350 520 380 480 Z"
          fill="#5B21B6"
          opacity="0.92"
        />
        {/* Feet */}
        <g className="companion-feet" stroke="#F59E0B" strokeWidth="18" strokeLinecap="round">
          <line x1="390" y1="776" x2="390" y2="830" />
          <line x1="500" y1="780" x2="500" y2="834" />
        </g>
      </svg>
    </div>
  );
}
