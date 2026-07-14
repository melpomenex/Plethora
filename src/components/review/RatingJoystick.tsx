/**
 * RatingJoystick — the visual overlay for the H-pattern 6-grade gesture.
 *
 * Anchors a 2-row × 3-column zone grid to the thumb's touchdown point and
 * renders a knob that tracks the drag. The zone under the knob lights up in
 * its grade color; a centered readout shows the committed grade's label and
 * next-review interval so the user always sees what they are committing.
 *
 * The overlay is `pointer-events-none` — it never intercepts the touch that
 * drives it (the gesture hook owns the element underneath).
 */

import { useMemo } from "react";
import {
  ArrowCounterClockwise,
  Lightning,
  Prohibit,
  ThumbsDown,
  ThumbsUp,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { formatInterval, type PreviewIntervals } from "../../api/review";
import {
  JOYSTICK_GRADES,
  type JoystickGrade,
} from "../../hooks/useRatingJoystick";

interface RatingJoystickProps {
  /** Active grade 0-5, or null while in the dead-zone. */
  activeGrade: number | null;
  /** Knob offset from the base, in px. */
  knob: { dx: number; dy: number };
  /** Base origin in viewport coords (where the thumb touched down). */
  base: { x: number; y: number } | null;
  isActive: boolean;
  previewIntervals?: PreviewIntervals | null;
}

/** Per-grade icon, kept in lockstep with `RatingButtons`' GRADE_BUTTONS. */
const GRADE_ICON: Record<number, typeof Prohibit> = {
  0: Prohibit,
  1: X,
  2: ArrowCounterClockwise,
  3: ThumbsDown,
  4: ThumbsUp,
  5: Lightning,
};

// Grid geometry. Cells are sized for a thumb reach; the whole grid is
// centered horizontally on the base, with the base sitting on the seam.
const CELL_W = 96;
const CELL_H = 72;
const GRID_W = CELL_W * 3;

export function RatingJoystick({
  activeGrade,
  knob,
  base,
  isActive,
  previewIntervals,
}: RatingJoystickProps) {
  const { t } = useI18n();

  // Pre-resolve labels + intervals so the grid doesn't recompute each move.
  const cells = useMemo(
    () =>
      JOYSTICK_GRADES.map((g) => ({
        ...g,
        label: t(g.labelKey),
        icon: GRADE_ICON[g.grade],
        interval:
          previewIntervals?.grade_intervals?.[g.grade] != null
            ? formatInterval(previewIntervals.grade_intervals[g.grade])
            : null,
      })),
    [t, previewIntervals],
  );

  if (!isActive || !base) return null;

  // Grid origin: horizontally centered on the base, vertically placed so the
  // seam between the two rows sits at the thumb.
  const gridLeft = base.x - GRID_W / 2;
  const gridTop = base.y - CELL_H;

  const active = cells.find((c) => c.grade === activeGrade) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      aria-hidden="true"
      style={{ touchAction: "none" }}
    >
      {/* Dim the card underneath so the zones pop. */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px]" />

      {/* Zone grid */}
      <div
        className="absolute grid grid-cols-3 gap-1.5"
        style={{ left: gridLeft, top: gridTop, width: GRID_W }}
      >
        {cells.map((cell: JoystickGrade & { label: string; icon: typeof Prohibit; interval: string | null }) => {
          const Icon = cell.icon;
          const lit = activeGrade === cell.grade;
          return (
            <div
              key={cell.grade}
              className="rounded-lg flex flex-col items-center justify-center transition-all duration-75 border"
              style={{
                width: CELL_W,
                height: CELL_H,
                backgroundColor: lit ? cell.tint : "transparent",
                borderColor: lit ? cell.tint : "color-mix(in srgb, var(--foreground) 20%, transparent)",
                opacity: lit ? 1 : 0.45,
                transform: lit ? "scale(1.05)" : "scale(1)",
              }}
            >
              <Icon className="w-5 h-5 text-white" weight="fill" />
              <span className="text-white text-xs font-semibold leading-tight mt-0.5">
                {cell.grade} {cell.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Joystick base + knob */}
      <div
        className="absolute rounded-full border-2 border-foreground/30 bg-background/80"
        style={{
          left: base.x - 28,
          top: base.y - 28,
          width: 56,
          height: 56,
        }}
      />
      <div
        className="absolute rounded-full shadow-lg transition-[background-color] duration-75"
        style={{
          left: base.x - 22 + knob.dx,
          top: base.y - 22 + knob.dy,
          width: 44,
          height: 44,
          backgroundColor: active ? active.tint : "var(--foreground)",
        }}
      />

      {/* Committed-grade readout (only once a grade is selected). */}
      {active && (
        <div className="absolute inset-x-0 bottom-[18%] flex flex-col items-center">
          <div
            className="px-5 py-2 rounded-xl text-white font-bold text-lg shadow-lg"
            style={{ backgroundColor: active.tint }}
          >
            {active.grade} {active.label}
          </div>
          {active.interval && (
            <div className="text-sm text-muted-foreground mt-1.5">
              {t("ratingButtons.nextReviewIn", { interval: active.interval })}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {t("review.joystickReleaseToRate")}
          </div>
        </div>
      )}

      {/* Dead-zone hint (thumb is down but no grade committed yet). */}
      {!active && (
        <div className="absolute inset-x-0 bottom-[18%] flex justify-center">
          <div className="text-sm text-muted-foreground">
            {t("review.joystickHint")}
          </div>
        </div>
      )}
    </div>
  );
}

export default RatingJoystick;
