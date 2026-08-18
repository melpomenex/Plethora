/**
 * StartupBird — "Friendly Chirp", the Plethora mascot, redrawn from
 * assets/brand/plethora-icon-master.svg proportions as an articulable inline
 * SVG for the Knowledge Peck startup animation.
 *
 * Part groups (data-kp-part) are the driver's write targets:
 *  - the wrapper div [bird] carries the scene-position transform,
 *  - the SVG groups [bird-head] (beak + eye, pivoting about a neck origin)
 *    and [bird-wing] carry small relative transforms.
 *
 * Brand fidelity is pinned by src/__tests__/brandInventory.test.ts:
 * gradient #8B5CF6 / #7C3AED / #5B21B6, beak #F59E0B, pupil #1E1B4B — the
 * companion's amber-beak convention (the master's darker violet beak reads
 * poorly on the dark boot surface). CompanionBird.tsx and the master SVG are
 * untouched; this file must not introduce a divergent mascot palette.
 */

import { KP_GEOMETRY } from "../../lib/startupAnimation/types";

interface StartupBirdProps {
  /** Rendered square size in CSS px (KP_GEOMETRY per form factor). */
  size: number;
  className?: string;
}

export function StartupBird({ size, className }: StartupBirdProps) {
  return (
    <div
      aria-hidden="true"
      data-kp-part="bird"
      className={className}
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 1024 1024"
        role="presentation"
        focusable="false"
        style={{ position: "absolute", left: -size / 2, top: -size / 2 }}
      >
        <defs>
          <linearGradient id="kp-bird-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="55%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#5B21B6" />
          </linearGradient>
        </defs>
        {/* Tail — the ascender stroke of the "P" silhouette */}
        <path
          d="M232 664 C150 690 118 756 128 830 C220 806 286 758 318 692 Z"
          fill="url(#kp-bird-body)"
        />
        {/* Body — the bowl of the "P" */}
        <ellipse
          cx="430"
          cy="560"
          rx="250"
          ry="230"
          fill="url(#kp-bird-body)"
        />
        {/* Wing */}
        <path
          data-kp-part="bird-wing"
          className="kp-bird-wing"
          d="M380 480 C500 420 640 440 700 520 C640 610 500 640 380 600 C350 560 350 520 380 480 Z"
          fill="#5B21B6"
          opacity="0.92"
        />
        {/* Head subgroup: head + tuft + beak + eye; pivots about the neck */}
        <g data-kp-part="bird-head" className="kp-bird-head">
          <circle cx="620" cy="330" r="150" fill="url(#kp-bird-body)" />
          {/* Tuft feathers */}
          <g className="kp-bird-tuft">
            <path
              d="M384 224 C362 176 327 145 286 138 C329 163 354 190 367 230 Z"
              fill="url(#kp-bird-body)"
            />
            <path
              d="M420 209 C398 150 355 113 313 102 C364 130 394 166 405 218 Z"
              fill="url(#kp-bird-body)"
            />
          </g>
          {/* Beak */}
          <path d="M756 330 L872 366 L756 402 Z" fill="#F59E0B" />
          {/* Eye */}
          <g className="kp-bird-eye">
            <circle cx="668" cy="300" r="30" fill="#FFFFFF" />
            <circle className="kp-bird-pupil" cx="676" cy="302" r="14" fill="#1E1B4B" />
          </g>
        </g>
        {/* Feet */}
        <g stroke="#F59E0B" strokeWidth="18" strokeLinecap="round">
          <line x1="390" y1="776" x2="390" y2="830" />
          <line x1="500" y1="780" x2="500" y2="834" />
        </g>
      </svg>
    </div>
  );
}

/** Geometry re-export for consumers sizing the bird from the shared constants. */
export const KP_BIRD_GEOMETRY = KP_GEOMETRY;
