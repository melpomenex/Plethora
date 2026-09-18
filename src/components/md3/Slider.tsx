import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../utils/cn";

/**
 * Material 3 slider on a native range input (keyboard + ARIA for free),
 * tinted through semantic tokens via accent-color. Value extremes are
 * announced by the native input's aria-valuenow.
 */
export const Slider = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Slider({ className, id, ...props }, ref) {
    return (
      <input
        ref={ref}
        id={id}
        type="range"
        className={cn(
          "md-slider h-6 w-full cursor-pointer appearance-none bg-transparent",
          "accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        style={{ accentColor: "var(--color-primary)" }}
        {...props}
      />
    );
  },
);
