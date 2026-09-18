import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";

/**
 * Material 3 button.
 *
 * Variants map to M3 roles: filled (primary), tonal (secondary-container),
 * outlined, text, and destructive (error). State layers come from the shared
 * `.md-state` utility (hover/focus/press overlays at M3 opacities); disabled
 * state reduces opacity and drops pointer events. All colors are semantic
 * tokens — no color literals here.
 */
export const buttonVariants = cva(
  "md-state md-focus-ring inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        filled: "bg-primary text-on-primary",
        tonal: "bg-secondary-container text-on-secondary-container",
        outlined: "border border-outline text-primary",
        text: "text-primary",
        destructive: "bg-error text-on-error",
        destructiveOutlined: "border border-error/60 text-error",
      },
      size: {
        sm: "min-h-8 px-4 text-xs",
        md: "min-h-10 px-6 text-sm",
        lg: "min-h-12 px-8 text-base",
        icon: "min-h-10 min-w-10 p-2",
        iconSm: "min-h-8 min-w-8 p-1.5",
      },
    },
    defaultVariants: { variant: "filled", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
});
