/**
 * Rating Joystick Hook — H-pattern "stick shift" gesture for the native
 * 0-5 grade scale (SM-18 / SM-20).
 *
 * Touch-down anywhere in the bound element springs up a joystick base under
 * the thumb. Dragging partitions the plane into a 2-row × 3-column H:
 *
 * ```
 *      PASS ROW (drag up)
 *   ┌────────┬────────┬────────┐
 *   │ Hard 3 │ Good 4 │ Easy 5 │
 *   └────────┴───┬────┴────────┘
 *               ●  ← base (under thumb)
 *   ┌────────┬───┴────┬────────┐
 *   │ Black0 │ Wrong1 │ Almst2 │
 *   └────────┴────────┴────────┘
 *      FAIL ROW (drag down)
 * ```
 *
 * A small dead-zone around the base makes a pure tap a no-op (cancel).
 * Crossing into a new zone fires a short haptic tick ("detent"); release
 * inside a zone fires `onSelect`. Release in the dead-zone cancels.
 *
 * This mirrors the shape of `useSwipeGesture` so it is a near drop-in.
 */

import { useRef, useCallback, useState, useEffect } from "react";
import { vibrate } from "../utils/soundService";
import { SUPERMEMO_GRADES } from "../lib/supermemo-grades";

/** Pixel radius around the base inside which no grade is selected. */
const DEAD_ZONE = 24;
/** Horizontal half-width of the center column, in px from the base. */
const COL_HALF = 48;
/** Haptic tick pattern for a zone cross (short click). */
const DETENT_MS = 8;

export interface JoystickGrade {
  grade: number;
  rating: 1 | 2 | 3 | 4;
  /** i18n key for the short label (e.g. "review.grade3" → "Hard"). */
  labelKey: string;
  /** Tailwind background class for the active zone + knob. */
  color: string;
  /** Hex tint used for the dimmed zone fill. */
  tint: string;
}

/** Hex tint per grade for the joystick zone fills (derived from the shared
 * grade colors so the joystick and tappable grid stay consistent). */
const TINT_BY_GRADE: Record<number, string> = {
  0: "#b91c1c",
  1: "#ef4444",
  2: "#f97316",
  3: "#f59e0b",
  4: "#3b82f6",
  5: "#22c55e",
};

/**
 * The 6 shared grades laid out on the H. Order is row-major for the 2×3 grid:
 * index 0-2 = pass row (3,4,5), index 3-5 = fail row (0,1,2).
 *
 * Grade semantics come from `lib/supermemo-grades`; only the H-layout order
 * and zone tints are joystick-specific.
 */
export const JOYSTICK_GRADES: JoystickGrade[] = [3, 4, 5, 0, 1, 2].map((grade) => {
  const shared = SUPERMEMO_GRADES.find((g) => g.grade === grade)!;
  return {
    grade: shared.grade,
    rating: shared.rating,
    labelKey: shared.labelKey,
    color: shared.color.split(" ")[0],
    tint: TINT_BY_GRADE[grade],
  };
});

/** Resolve the grade for a thumb delta relative to the base. Returns
 * `null` while inside the dead-zone (no commitment yet). */
function gradeForDelta(dx: number, dy: number): number | null {
  const mag = Math.hypot(dx, dy);
  if (mag < DEAD_ZONE) return null;

  // Row: drag up (dy<0) = pass row, drag down (dy>0) = fail row.
  const isPass = dy <= 0;
  // Column: left / center / right.
  const col = dx < -COL_HALF ? 0 : dx > COL_HALF ? 2 : 1;

  // Pass row: col 0,1,2 → grades 3,4,5. Fail row: col 0,1,2 → 0,1,2.
  return isPass ? 3 + col : col;
}

export interface UseRatingJoystickOptions {
  onSelect: (rating: 1 | 2 | 3 | 4, grade: number) => void;
  /** Gate the whole gesture (e.g. only when the answer is shown). */
  enabled?: () => boolean;
  /** Bind the gesture to an external element (e.g. the card container)
   *  instead of the hook's own ref. */
  targetRef?: React.RefObject<HTMLDivElement | null>;
}

export interface UseRatingJoystickReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  /** Active grade 0-5, or `null` while in the dead-zone. */
  activeGrade: number | null;
  /** Knob offset from base, in px (for the knob render). */
  knob: { dx: number; dy: number };
  /** Base origin in viewport coords (so the overlay can anchor to it). */
  base: { x: number; y: number } | null;
  isActive: boolean;
}

export function useRatingJoystick(
  options: UseRatingJoystickOptions,
): UseRatingJoystickReturn {
  const { onSelect, enabled, targetRef } = options;

  const internalRef = useRef<HTMLDivElement | null>(null);
  const ref = targetRef ?? internalRef;
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastGradeRef = useRef<number | null>(null);

  const [activeGrade, setActiveGrade] = useState<number | null>(null);
  const [knob, setKnob] = useState({ dx: 0, dy: 0 });
  const [base, setBase] = useState<{ x: number; y: number } | null>(null);
  const [isActive, setIsActive] = useState(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (enabled && !enabled()) return;
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      lastGradeRef.current = null;
      setBase({ x: t.clientX, y: t.clientY });
      setKnob({ dx: 0, dy: 0 });
      setActiveGrade(null);
      setIsActive(true);
    },
    [enabled],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!startRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;

      // Clamp the knob to a comfortable radius so it can't fly off-screen.
      const mag = Math.hypot(dx, dy);
      const MAX = 120;
      const scale = mag > MAX ? MAX / mag : 1;
      setKnob({ dx: dx * scale, dy: dy * scale });

      const grade = gradeForDelta(dx, dy);
      setActiveGrade(grade);

      // Fire a haptic detent only when crossing into a NEW grade.
      if (grade !== lastGradeRef.current) {
        lastGradeRef.current = grade;
        vibrate("click");
        void DETENT_MS; // pattern length is owned by soundService; kept for clarity
      }

      // Prevent the page from scrolling while the user is committing a grade.
      if (mag > 8) e.preventDefault();
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    if (!startRef.current) return;
    const grade = activeGrade;
    if (grade != null) {
      const entry = JOYSTICK_GRADES.find((g) => g.grade === grade);
      if (entry) onSelect(entry.rating, entry.grade);
    }
    // Reset.
    startRef.current = null;
    lastGradeRef.current = null;
    setBase(null);
    setKnob({ dx: 0, dy: 0 });
    setActiveGrade(null);
    setIsActive(false);
  }, [activeGrade, onSelect]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // touchmove must be non-passive so we can preventDefault during a commit.
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { ref, activeGrade, knob, base, isActive };
}

export default useRatingJoystick;
