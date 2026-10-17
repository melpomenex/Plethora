import type { ButtonHTMLAttributes } from "react";
import { Tooltip } from "../md3/Tooltip";
import "./rating-orbs.css";

export type RatingOrbAction = "again" | "hard" | "good" | "easy" | "dismiss";

/** Shared presentation only: each reader retains its own grading and haptics. */
export function RatingOrb({ action, title, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  action: RatingOrbAction;
  title: string;
}) {
  return <Tooltip text={title} portal className="rating-orb-anchor">
    <button {...props} type="button" title={title} aria-label={title} className="rating-orb" data-rating-action={action}>
      {children}
    </button>
  </Tooltip>;
}
