/**
 * Knowledge Peck startup animation — shared types and geometry constants.
 *
 * Pure data only: no timers, no DOM, no store access. The state-machine
 * transition table lives in machine.ts; phase scripts live in variants.ts.
 */

/** Registry key for the choreography variant (see variants.ts, design D12). */
export type KPVariantId = "knowledge-peck";

/**
 * Form factor for the startup scene. Derived once at overlay mount from the
 * presentation utilities (`presentationUsesMobileShell`): the phone script is
 * a deliberately simpler composition, never a shrunken desktop scene.
 */
export type FormFactor = "desktop" | "phone";

/** Lifecycle stages (design D3). */
export type Stage =
  | "handoff"
  | "choreography"
  | "idle"
  | "resolve"
  | "reveal"
  | "done"
  | "aborted";

/** Lifecycle events (design D3). */
export type KPEvent =
  | "MOUNTED"
  | "APP_READY"
  | "APP_ERROR"
  | "WATCHDOG"
  | "SETTINGS_OFF"
  | "FORCE_EXIT";

/**
 * Which animation variant the overlay plays, resolved once at mount with the
 * D8 precedence: kill switch → e-ink → reduced motion → full choreography.
 */
export type KPAnimationMode = "full" | "reduced-motion" | "eink" | "none";

export type PhaseName =
  | "entrance"
  | "fragments"
  | "notice"
  | "peck-1"
  | "peck-2"
  | "peck-3"
  | "consolidate"
  | "converge"
  | "wordmark"
  | "hold"
  | "reveal";

/** One beat of a choreography script, in virtual ms from scene start. */
export interface Phase {
  name: PhaseName;
  start: number;
  end: number;
}

/**
 * Pure-data choreography script for one (variant, formFactor) pair. Consumed
 * by timeline.ts; the driver/component never hardcode phase content.
 */
export interface PhaseScript {
  formFactor: FormFactor;
  /** Number of floating knowledge fragments (desktop 3, phone 2). */
  fragmentCount: number;
  /** Number of peck beats (desktop 3, phone 2). */
  peckCount: number;
  /** Phases strictly ordered by start time. */
  phases: Phase[];
  /** End of the wordmark phase = branded span end (entrance→wordmark). */
  brandedSpanEnd: number;
  /** When the scene settles into the stable idle pose (hold.start). */
  idleAt: number;
  /** When the happy-path reveal fade starts (hold.end). */
  revealAt: number;
  /** When the overlay is fully gone on the happy path (reveal.end). */
  revealEnd: number;
}

/** Built timeline: the script plus precomputed phase lookup helpers. */
export interface Timeline {
  variant: KPVariantId;
  formFactor: FormFactor;
  script: PhaseScript;
  phases: Phase[];
  /** Phase active at virtual time t (the last phase whose window contains t). */
  phaseAt: (t: number) => Phase;
}

/**
 * Per-element sampled state at one instant. Strictly transform/opacity — the
 * compositor-friendly pair (spec: theme determinism & visual restraint).
 */
export interface ElementState {
  id: string;
  opacity: number;
  transform: string;
}

/**
 * Geometry shared by the React overlay and the static pre-React frame in
 * index.html. A parity unit test pins index.html to these exact values so the
 * two layers cannot drift (design D1/D7).
 */
export const KP_GEOMETRY = {
  /** Boot surface behind every layer (matches PageLoader + native splash). */
  bootSurface: "#0A0A0A",
  /** E-ink variant switches its surface to white as soon as JS can detect. */
  einkSurface: "#FFFFFF",
  /** Centered scene container cap; desktop reads compact, not scattered. */
  containerMaxWidth: 480,
  /** Rendered mascot size in CSS px per form factor. */
  mascotSizeDesktop: 112,
  mascotSizePhone: 132,
} as const;
