/**
 * SixGradeRatingControl — the shared orchestration for rating on the native
 * 0-5 six-grade scale, used by Review, Zen mode, and the Queue.
 *
 * On touch form factors it wires the H-pattern joystick gesture
 * (`useRatingJoystick` + `RatingJoystick`) to the touch area; on desktop it
 * renders the tappable six-button grid (`RatingButtons gradeScale`). The
 * grade↔rating semantics come from `lib/rating-grades`.
 *
 * Render this only when the active rating schema is six-grade
 * (`useRatingSchema().type === "six-grade" || useRatingSchema().type === "supermemo"`);
 * four-grade schedulers keep their existing 4-button/swipe UI.
 */

import { useRef } from "react";
import { useFormFactor } from "../../hooks/useFormFactor";
import { useRatingJoystick } from "../../hooks/useRatingJoystick";
import { RatingJoystick } from "./RatingJoystick";
import { RatingButtons } from "./RatingButtons";
import type { PreviewIntervals } from "../../api/review";
import type { ReviewRating, NativeGrade } from "../../lib/rating-grades";

/** True when the current form factor is a touch device (phone/tablet). */
export function useIsTouchRating(): boolean {
  const formFactor = useFormFactor();
  return formFactor === "phone" || formFactor === "tablet";
}

export interface SixGradeRatingControlProps {
  onSelect: (rating: ReviewRating, grade: NativeGrade) => void;
  /** Gate the joystick gesture (e.g. only when the answer is shown). */
  enabled?: () => boolean;
  /** Disable the tappable grid (and the gesture via `enabled` upstream). */
  disabled?: boolean;
  previewIntervals?: PreviewIntervals | null;
  /** Advisory highlight of the assessment-suggested grade. */
  suggestedRating?: ReviewRating;
  /**
   * Element the joystick gesture binds to on touch — typically the card
   * container, so the thumb can land anywhere on the card. When omitted the
   * control binds to its own wrapper.
   */
  touchAreaRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Render the tappable six-button grid alongside the joystick/touch path.
   * Zen mode omits it (keyboard-only desktop, joystick-only touch).
   */
  showButtons?: boolean;
}

export type SuperMemoRatingControlProps = SixGradeRatingControlProps;

function TouchSixGradeRating({
  onSelect,
  enabled,
  disabled,
  previewIntervals,
  suggestedRating,
  touchAreaRef,
  showButtons = true,
}: SixGradeRatingControlProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const joystick = useRatingJoystick({
    onSelect: (rating, grade) => onSelect(rating as ReviewRating, grade as NativeGrade),
    enabled,
    targetRef: touchAreaRef ?? localRef,
  });

  return (
    <div ref={localRef} className="w-full">
      <RatingJoystick
        activeGrade={joystick.activeGrade}
        knob={joystick.knob}
        base={joystick.base}
        isActive={joystick.isActive}
        previewIntervals={previewIntervals}
      />
      {showButtons && (
        <RatingButtons
          onSelectRating={onSelect}
          disabled={disabled}
          previewIntervals={previewIntervals}
          gradeScale
          suggestedRating={suggestedRating}
        />
      )}
    </div>
  );
}

export function SixGradeRatingControl(props: SixGradeRatingControlProps) {
  const isTouch = useIsTouchRating();
  if (isTouch) return <TouchSixGradeRating {...props} />;
  if (props.showButtons === false) return null;
  return (
    <RatingButtons
      onSelectRating={props.onSelect}
      disabled={props.disabled}
      previewIntervals={props.previewIntervals}
      gradeScale
      suggestedRating={props.suggestedRating}
    />
  );
}

/** Backward compatibility alias */
export const SuperMemoRatingControl = SixGradeRatingControl;
