import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

/**
 * Material 3 icon button. Requires an accessible name (aria-label when there
 * is no visible text). Interactive area is ≥40px (48px touch via padding
 * hit-slop on coarse pointers is left to the presentation layer).
 */
export const iconButtonVariants = cva(
  "md-state md-focus-ring inline-flex select-none items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        standard: "text-on-surface-variant",
        filled: "bg-primary text-on-primary",
        tonal: "bg-secondary-container text-on-secondary-container",
        outlined: "border border-outline text-on-surface-variant",
        destructiveTonal: "bg-error-container text-on-error-container",
      },
      size: {
        sm: "h-8 w-8 [&_svg]:h-4 [&_svg]:w-4",
        md: "h-10 w-10 [&_svg]:h-5 [&_svg]:w-5",
        lg: "h-12 w-12 [&_svg]:h-6 [&_svg]:w-6",
      },
    },
    defaultVariants: { variant: "standard", size: "md" },
  },
);

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof iconButtonVariants> {
  /** Phosphor icon component to render. */
  icon: Icon;
  /** Accessible name; required because the visible content is icon-only. */
  "aria-label": string;
  /** Toggle state for two-state icon buttons (e.g. bookmark). */
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, icon: IconCmp, pressed, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      <IconCmp aria-hidden="true" />
    </button>
  );
});
