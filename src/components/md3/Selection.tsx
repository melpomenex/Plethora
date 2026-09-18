import { forwardRef, type InputHTMLAttributes } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

/**
 * Material 3 checkbox built on a visually-hidden native input (free ARIA +
 * keyboard) with a token-styled box overlay. Checked state is a checkmark,
 * not a color change.
 */
export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Checkbox({ className, id, ...props }, ref) {
    return (
      <span className={cn("md-hit-slop relative inline-flex h-6 w-6 shrink-0 items-center justify-center", className)}>
        <input ref={ref} id={id} type="checkbox" className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" {...props} />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex h-5 w-5 items-center justify-center rounded-sm border-2 transition-colors",
            "border-on-surface-variant peer-hover:bg-on-surface/10 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
            "peer-checked:[&>*]:opacity-100 peer-checked:border-primary peer-checked:bg-primary",
            "peer-disabled:pointer-events-none peer-disabled:opacity-40",
          )}
        >
          <Check className="h-3.5 w-3.5 text-on-primary opacity-0 transition-opacity" weight="bold" />
        </span>
      </span>
    );
  },
);

/** Material 3 radio built the same way as Checkbox. */
export const Radio = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Radio({ className, id, ...props }, ref) {
    return (
      <span className={cn("md-hit-slop relative inline-flex h-6 w-6 shrink-0 items-center justify-center", className)}>
        <input ref={ref} id={id} type="radio" className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" {...props} />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
            "border-on-surface-variant peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary",
            "peer-checked:[&>*]:opacity-100 peer-checked:border-primary peer-disabled:pointer-events-none peer-disabled:opacity-40",
          )}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-primary opacity-0 transition-opacity" />
        </span>
      </span>
    );
  },
);
